param(
    [string]$InputPath = "..\assets\graphic_text_min.png",
    [string]$Password = "heslo1234",
    [int]$Iterations = 100000,
    [string]$OutputPath = ".\encrypted-image.json"
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$combinedPath = Join-Path $scriptDir $InputPath
if (-not (Test-Path $combinedPath)) {
    throw "Input file not found: $combinedPath"
}
$resolvedPath = Resolve-Path -Path $combinedPath

[byte[]]$plain = [System.IO.File]::ReadAllBytes($resolvedPath)
$rand = [System.Security.Cryptography.RandomNumberGenerator]::Create()

$salt = New-Object byte[] 16
$rand.GetBytes($salt)

$iv = New-Object byte[] 16
$rand.GetBytes($iv)

$pbkdf2 = New-Object System.Security.Cryptography.Rfc2898DeriveBytes($Password, $salt, $Iterations)
$key = $pbkdf2.GetBytes(32)

$aes = [System.Security.Cryptography.Aes]::Create()
$aes.Mode = [System.Security.Cryptography.CipherMode]::CBC
$aes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
$aes.KeySize = 256
$aes.Key = $key
$aes.IV = $iv

$encryptor = $aes.CreateEncryptor()
$encrypted = $encryptor.TransformFinalBlock($plain, 0, $plain.Length)

$result = [PSCustomObject]@{
    salt = [Convert]::ToBase64String($salt)
    iv = [Convert]::ToBase64String($iv)
    data = [Convert]::ToBase64String($encrypted)
    iterations = $Iterations
}

$outputFullPath = Join-Path $scriptDir $OutputPath
$result | ConvertTo-Json -Depth 3 | Set-Content -Encoding utf8 -Path $outputFullPath
Write-Output "Encrypted data saved to $outputFullPath"
