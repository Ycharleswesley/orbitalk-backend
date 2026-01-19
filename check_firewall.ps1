# Check if Port 8080 is open
$port = 8080
$rules = Get-NetFirewallRule | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' } | Get-NetFirewallPortFilter | Where-Object { $_.LocalPort -eq $port }

if ($rules) {
    Write-Host "Port $port is ALLOWED."
    $rules | Format-List
} else {
    Write-Host "Port $port is NOT explicitly allowed by an Inbound Rule."
    Write-Host "This is likely blocking the connection from your phone."
}
