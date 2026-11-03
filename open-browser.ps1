param([string]$Url = "http://localhost:4000/admin/")
for ($i = 0; $i -lt 90; $i++) {
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -ge 200) {
            Start-Process $Url
            exit 0
        }
    } catch {}
    Start-Sleep -Seconds 1
}
