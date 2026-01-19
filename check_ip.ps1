# Get all IPv4 addresses
$ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike "*Loopback*" -and $_.InterfaceAlias -notlike "*vEthernet*" }

Write-Host "-------------------------------------------"
Write-Host " Available IPv4 Addresses (Use one of these)"
Write-Host "-------------------------------------------"

foreach ($ip in $ips) {
    Write-Host "Interface: $($ip.InterfaceAlias)"
    Write-Host "IP Address: $($ip.IPAddress)"
    Write-Host "-------------------------------------------"
}
