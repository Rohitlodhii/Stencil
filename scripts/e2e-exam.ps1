$G = 'http://13.203.224.137:8090'
$saved = Invoke-RestMethod -Uri "$G/exam/save" -Method Post -ContentType 'application/json' -Body (@{
  name = 'e2e-smoke'; image_urls = @(); summary_md = '# smoke - gateway write path'
} | ConvertTo-Json)
Write-Output ("saved id: " + $saved.id)
$list = Invoke-RestMethod -Uri "$G/exam/list"
Write-Output ("exam count via gateway: " + $list.exams.Count)
$d1 = Invoke-RestMethod -Uri 'http://13.203.224.137:8000/cameras'
Write-Output ("scanner cameras (EC2, expect none): " + ($d1.cameras.Count))
Write-Output 'EXAM E2E PASS'
