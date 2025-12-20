# Encrypts a single plaintext message (stored in a CSV with code/message columns)
# so it can be safely embedded in the calendar frontend and unlocked via password.

param(
    [string]$InputCsv = ".\private\final-secret.csv",
    [string]$OutputFile = ".\messages\finale.json",
    [int]$Iterations = 100000
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Resolve-ExistingPath {
    param([string]$Path)
    if ([System.IO.Path]::IsPathRooted($Path)) {
        if (-not (Test-Path $Path)) {
            throw "Path not found: $Path"
        }
        return (Resolve-Path $Path).Path
    }
    $combined = Join-Path $scriptDir $Path
    if (-not (Test-Path $combined)) {
        throw "Path not found: $combined"
    }
    return (Resolve-Path $combined).Path
}

function Get-AbsolutePath {
    param([string]$Path)
    if ([System.IO.Path]::IsPathRooted($Path)) {
        return $Path
    }
    return (Join-Path $scriptDir $Path)
}

function Protect-Text {
    param(
        [string]$Message,
        [string]$Password,
        [int]$Iterations
    )

    $plainBytes = [System.Text.Encoding]::UTF8.GetBytes($Message)
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
    $encrypted = $encryptor.TransformFinalBlock($plainBytes, 0, $plainBytes.Length)

    return [PSCustomObject]@{
        salt       = [Convert]::ToBase64String($salt)
        iv         = [Convert]::ToBase64String($iv)
        data       = [Convert]::ToBase64String($encrypted)
        iterations = $Iterations
    }
}

$csvPath = Resolve-ExistingPath $InputCsv
$outputPath = Get-AbsolutePath $OutputFile

$records = @(Import-Csv -Path $csvPath)
if ($records.Count -lt 1) {
    throw "CSV does not contain any data. Expected a header row with 'code' and 'message'."
}

$columns = $records[0].PSObject.Properties.Name
if (-not ($columns -contains "code" -and $columns -contains "message")) {
    throw "CSV must include 'code' and 'message' columns."
}

$entry = $records[0]
$code = $entry.code
$message = $entry.message

if ([string]::IsNullOrWhiteSpace($code)) {
    throw "The 'code' column is empty."
}
if ([string]::IsNullOrWhiteSpace($message)) {
    throw "The 'message' column is empty."
}

$payload = Protect-Text -Message $message -Password $code -Iterations $Iterations
$payload | Add-Member -NotePropertyName "contentType" -NotePropertyValue "text/plain"

$outputDir = Split-Path -Parent $outputPath
if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

$payload | ConvertTo-Json -Depth 3 | Set-Content -Encoding utf8 -Path $outputPath
Write-Output "Encrypted message exported to $outputPath"
