# Check for Administrator privileges
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "Requesting Administrator privileges..."
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit
}

$port = 8080
$ruleName = "Allow-OrbiTalk-Backend-8080"

# Remove existing rule if it exists (to avoid duplicates)
Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue

# Create new Allow rule
New-NetFirewallRule -DisplayName $ruleName `
                    -Direction Inbound `
                    -LocalPort $port `
                    -Protocol TCP `
                    -Action Allow `
                    -Profile Any

Write-Host "Successfully opened Port $port for Inbound traffic."
Write-Host "Press any key to close..."
$host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
