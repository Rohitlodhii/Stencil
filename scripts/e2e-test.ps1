$G = 'http://13.203.224.137:8090'
$ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$email = "e2e.teacher.$ts@example.com"

Write-Output '--- 1. teacher register'
$r1 = Invoke-RestMethod -Uri "$G/auth/teacher/register" -Method Post -ContentType 'application/json' -Body (@{
  name = 'E2E Teacher'; email = $email; password = 'teacher123';
  teacher_id = "T$ts"; college = 'RGPV Bhopal'
} | ConvertTo-Json)
$r1 | ConvertTo-Json

Write-Output '--- 2. teacher login before approval (expect pending_approval)'
try {
  Invoke-RestMethod -Uri "$G/auth/teacher/login" -Method Post -ContentType 'application/json' -Body (@{
    email = $email; password = 'teacher123'
  } | ConvertTo-Json) | Out-Null
  Write-Output 'UNEXPECTED: login succeeded before approval'
} catch {
  Write-Output ("got expected failure: " + $_.Exception.Message)
}

Write-Output '--- 3. coordinator login'
$coord = Invoke-RestMethod -Uri "$G/auth/coordinator/login" -Method Post -ContentType 'application/json' -Body (@{
  coordinator_id = 'coord_rgpv'; password = 'coord123'
} | ConvertTo-Json)
Write-Output ("coordinator: " + $coord.user.name + " / " + $coord.user.college)
$token = $coord.token

Write-Output '--- 4. pending requests'
$req = Invoke-RestMethod -Uri "$G/auth/coordinator/requests?status=pending" -Headers @{ Authorization = "Bearer $token" }
$mine = $req.requests | Where-Object { $_.email -eq $email }
Write-Output ("pending count: " + $req.requests.Count + ", mine id: " + $mine.id)

Write-Output '--- 5. approve'
$dec = Invoke-RestMethod -Uri "$G/auth/coordinator/requests/$($mine.id)/decision" -Method Post -ContentType 'application/json' -Headers @{ Authorization = "Bearer $token" } -Body (@{ decision = 'approved' } | ConvertTo-Json)
$dec | ConvertTo-Json

Write-Output '--- 6. teacher login after approval'
$tlogin = Invoke-RestMethod -Uri "$G/auth/teacher/login" -Method Post -ContentType 'application/json' -Body (@{
  email = $email; password = 'teacher123'
} | ConvertTo-Json)
Write-Output ("teacher login OK: " + $tlogin.user.name + " status=" + $tlogin.user.status)
Write-Output 'E2E PASS'
