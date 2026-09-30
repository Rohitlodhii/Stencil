<# Deploy mponline backends (exam-api, scanner, auth, gateway + local PG)
   to the single EC2 host via AWS CLI + SSH + Docker Compose.

   Usage:  pwsh scripts/deploy-ec2.ps1 [-KeyPath <pem>] [-EnvFile <file>]
   Prereqs: AWS CLI configured (region ap-south-1), OpenSSH client.

   What it does:
    1. Resolves i-0aa723c7bb18f7bd0 public/private IP via AWS CLI.
    2. Opens SG ports 8002 (auth) + 8090 (gateway) if missing.
    3. Installs Docker + compose plugin on the EC2 (Ubuntu/Amazon Linux).
    4. Syncs code + compose + .env.ec2 to ~/mponline on the EC2.
    5. Builds + starts the stack, prints container status + health checks.
   Frontends (apps/web, apps/desktop) are NOT deployed — their .env files
   are repointed to the EC2 public IP separately (see -UpdateFrontends).
#>
param(
  [string]$KeyPath = "$HOME/.ssh/sih139-backend-key.pem",
  [string]$EnvFile = "deploy/.env.ec2",
  [string]$InstanceId = "i-0aa723c7bb18f7bd0",
  [switch]$UpdateFrontends
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

function Info($m) { Write-Host "[deploy] $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "[deploy] $m" -ForegroundColor Green }
function Fail($m) { Write-Host "[deploy] ERROR: $m" -ForegroundColor Red; exit 1 }

# --- 0. sanity ---
if (-not (Test-Path $KeyPath)) { Fail "SSH key not found: $KeyPath" }
if (-not (Test-Path (Join-Path $Root $EnvFile))) {
  Fail "Missing $EnvFile — copy deploy/.env.ec2.example to $EnvFile and fill secrets first."
}
try { aws sts get-caller-identity --output json | Out-Null } catch { Fail "AWS CLI not authenticated." }

# --- 1. resolve IPs via AWS CLI ---
Info "Resolving $InstanceId via AWS CLI..."
$desc = aws ec2 describe-instances --instance-ids $InstanceId --output json | ConvertFrom-Json
$inst = $desc.Reservations[0].Instances[0]
if ($inst.State.Name -ne "running") { Fail "Instance state is $($inst.State.Name), expected running." }
$PubIp  = $inst.PublicIpAddress
$PrivIp = $inst.PrivateIpAddress
$Az     = $inst.Placement.AvailabilityZone
$SgId   = $inst.SecurityGroups[0].GroupId
Info "public=$PubIp private=$PrivIp az=$Az sg=$SgId"

# --- 2. open SG ports 8002 + 8090 (idempotent) ---
$sg = aws ec2 describe-security-groups --group-ids $SgId --output json | ConvertFrom-Json
$openPorts = @()
foreach ($p in $sg.SecurityGroups[0].IpPermissions) {
  if ($p.FromPort) { for ($i = $p.FromPort; $i -le $p.ToPort; $i++) { $openPorts += $i } }
}
foreach ($port in @(8002, 8090)) {
  if ($openPorts -contains $port) { Info "SG $SgId already allows :$port"; continue }
  Info "Authorizing SG $SgId :$port from 0.0.0.0/0 ..."
  aws ec2 authorize-security-group-ingress --group-id $SgId --protocol tcp --port $port --cidr 0.0.0.0/0 | Out-Null
  Ok "SG port $port opened."
}

# --- 3. install docker on EC2 ---
$sshBase = @("-i", $KeyPath, "-o", "StrictHostKeyChecking=accept-new", "ubuntu@$PubIp")
# AMI ami-07f35208dba26f009 = Ubuntu; fall back to ec2-user if ubuntu fails
$RemoteUser = "ubuntu"
$sshTest = & ssh -i $KeyPath -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 "ubuntu@$PubIp" "echo ok" 2>&1
if ($LASTEXITCODE -ne 0) {
  Info "ubuntu@ failed, trying ec2-user@..."
  $sshTest2 = & ssh -i $KeyPath -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 "ec2-user@$PubIp" "echo ok" 2>&1
  if ($LASTEXITCODE -ne 0) { Fail "SSH failed for both ubuntu@ and ec2-user@. Output: $sshTest" }
  $RemoteUser = "ec2-user"
}
Info "SSH user: $RemoteUser@$PubIp"
function Ssh([string]$cmd) {
  & ssh -i $KeyPath -o StrictHostKeyChecking=accept-new "$RemoteUser@$PubIp" $cmd
  if ($LASTEXITCODE -ne 0) { Fail "SSH command failed: $cmd" }
}

Info "Ensuring Docker + compose plugin on EC2..."
Ssh "sudo apt-get update -y && sudo apt-get install -y docker.io docker-compose-plugin curl || (sudo yum install -y docker && sudo systemctl start docker)"
Ssh "sudo systemctl enable --now docker; sudo usermod -aG docker $RemoteUser; docker --version; docker compose version"
Ssh "mkdir -p ~/mponline/deploy/postgres-init ~/mponline/apps/api ~/mponline/apps/auth-service ~/mponline/apps/gateway"
Ok "Docker ready."

# --- 4. sync files ---
function ScpTo([string]$localRel, [string]$remoteRel) {
  $local = Join-Path $Root $localRel
  if (-not (Test-Path $local)) { Fail "Missing local path: $local" }
  & scp -i $KeyPath -o StrictHostKeyChecking=accept-new -r $local "$RemoteUser@${PubIp}:$remoteRel"
  if ($LASTEXITCODE -ne 0) { Fail "SCP failed: $localRel -> $remoteRel" }
}
Info "Syncing code to EC2 ~/mponline ..."
ScpTo "docker-compose.ec2.yml" "~/mponline/docker-compose.yml"
ScpTo $EnvFile "~/mponline/.env.ec2"
ScpTo "deploy/postgres-init/01-databases.sh" "~/mponline/deploy/postgres-init/01-databases.sh"
ScpTo "apps/api/Dockerfile" "~/mponline/apps/api/Dockerfile"
ScpTo "apps/api/pyproject.toml" "~/mponline/apps/api/pyproject.toml"
ScpTo "apps/api/app" "~/mponline/apps/api/app"
ScpTo "apps/api/src" "~/mponline/apps/api/src"
ScpTo "apps/auth-service/Dockerfile" "~/mponline/apps/auth-service/Dockerfile"
ScpTo "apps/auth-service/pyproject.toml" "~/mponline/apps/auth-service/pyproject.toml"
ScpTo "apps/auth-service/app" "~/mponline/apps/auth-service/app"
ScpTo "apps/gateway/Dockerfile" "~/mponline/apps/gateway/Dockerfile"
ScpTo "apps/gateway/pyproject.toml" "~/mponline/apps/gateway/pyproject.toml"
ScpTo "apps/gateway/app" "~/mponline/apps/gateway/app"
Ok "Sync done."

# --- 5. build + start ---
Info "Building + starting stack (this takes a few minutes on first run)..."
Ssh "cd ~/mponline && set -a; . ./.env.ec2; set +a; sudo -E docker compose up -d --build"
Ssh "cd ~/mponline && sudo docker compose ps; sudo docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"
Ok "Stack started. Waiting 15s for app boot, then health checks..."
Start-Sleep -Seconds 15
Ssh "for p in '8000:scanner /health' '8001:exam /health' '8002:auth /health' '8090:gateway /health'; do port=`$${p%%:*}; path=`$${p##* }; echo \"== :`$port`$path ==\"; curl -sm 8 http://localhost:`$port`$path || echo FAILED; done; echo '== gateway aggregated =='; curl -sm 10 http://localhost:8090/health || echo FAILED"

# --- 6. optionally repoint frontends ---
if ($UpdateFrontends) {
  Info "Repointing apps/desktop/.env + apps/web/.env.local to http://$PubIp ..."
  $deskEnv = Join-Path $Root "apps/desktop/.env"
  $webEnv  = Join-Path $Root "apps/web/.env.local"
  Set-Content -Path $deskEnv -Value @(
    "VITE_SCANNER_URL=http://$PubIp`:8000",
    "VITE_API_URL=http://$PubIp`:8001",
    "VITE_GATEWAY_URL=http://$PubIp`:8090",
    "VITE_AUTH_URL=http://$PubIp`:8090"
  )
  $webLines = @()
  if (Test-Path $webEnv) { $webLines = Get-Content $webEnv | Where-Object { $_ -notmatch 'NEXT_PUBLIC_(SCANNER|API|GATEWAY|AUTH)_URL' } }
  $webLines += "NEXT_PUBLIC_SCANNER_URL=http://$PubIp`:8000"
  $webLines += "NEXT_PUBLIC_API_URL=http://$PubIp`:8001"
  $webLines += "NEXT_PUBLIC_GATEWAY_URL=http://$PubIp`:8090"
  $webLines += "NEXT_PUBLIC_AUTH_URL=http://$PubIp`:8090"
  Set-Content -Path $webEnv -Value $webLines
  Ok "Frontends repointed (local-only, NOT deployed)."
}

Ok "Done. Public endpoints:"
Write-Host "  scanner  http://$PubIp`:8000  (/health /status /cameras)" -ForegroundColor Yellow
Write-Host "  exam-api http://$PubIp`:8001  (/health /docs)" -ForegroundColor Yellow
Write-Host "  auth     http://$PubIp`:8002  (/health /docs)" -ForegroundColor Yellow
Write-Host "  gateway  http://$PubIp`:8090  (/health /docs)  <-- desktop/web entrypoint" -ForegroundColor Yellow
