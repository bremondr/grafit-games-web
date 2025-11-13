# Batch-encrypts 24 numbered calendar images using per-day passwords.
# Provide a folder that contains files named 1.* through 24.* and a CSV
# with columns "day,password". Encrypted JSON blobs will be written to the
# designated output folder so the frontend can fetch images per day.

param(
    [string]$ImageFolder = "..\assets\calendar-images",
    [string]$PasswordsCsv = ".\passwords.csv",
    [string]$OutputFolder = ".\images",
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

function Get-ContentType {
    param([string]$FileName)
    $extension = [System.IO.Path]::GetExtension($FileName).ToLowerInvariant()
    switch ($extension) {
        ".png"  { return "image/png" }
        ".jpg"  { return "image/jpeg" }
        ".jpeg" { return "image/jpeg" }
        ".gif"  { return "image/gif" }
        ".webp" { return "image/webp" }
        ".svg"  { return "image/svg+xml" }
        default { return "application/octet-stream" }
    }
}

function Protect-File {
    param(
        [string]$FilePath,
        [string]$Password,
        [int]$Iterations
    )

    [byte[]]$plain = [System.IO.File]::ReadAllBytes($FilePath)
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

    return [PSCustomObject]@{
        salt       = [Convert]::ToBase64String($salt)
        iv         = [Convert]::ToBase64String($iv)
        data       = [Convert]::ToBase64String($encrypted)
        iterations = $Iterations
    }
}

$sourceDir = Resolve-ExistingPath $ImageFolder
$csvPath = Resolve-ExistingPath $PasswordsCsv
$outputDir = Get-AbsolutePath $OutputFolder

if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
}
$outputDir = (Resolve-Path $outputDir).Path

$records = Import-Csv -Path $csvPath
if (-not $records) {
    throw "CSV file does not contain any rows."
}

$columns = $records[0].PSObject.Properties.Name
if (-not ($columns -contains "day" -and $columns -contains "password")) {
    throw "CSV must have 'day' and 'password' columns."
}

$seenDays = @{}

foreach ($entry in $records) {
    $day = [int]$entry.day
    if ($day -lt 1 -or $day -gt 24) {
        throw "Day '$($entry.day)' is outside the supported range 1-24."
    }
    if ($seenDays.ContainsKey($day)) {
        throw "Duplicate day '$day' detected in CSV."
    }

    $password = $entry.password
    if ([string]::IsNullOrWhiteSpace($password)) {
        throw "Missing password for day $day."
    }

    $pattern = "$day.*"
    $matches = Get-ChildItem -Path $sourceDir -File -Filter $pattern
    if ($matches.Count -eq 0) {
        throw "No image found for day $day in $sourceDir (expected file named '$day' with an extension)."
    }
    if ($matches.Count -gt 1) {
        throw "Multiple images found for day $day in $sourceDir. Ensure only one file matches '$pattern'."
    }

    $imagePath = $matches[0].FullName
    $contentType = Get-ContentType $matches[0].Name
    $payload = Protect-File -FilePath $imagePath -Password $password -Iterations $Iterations
    $payload | Add-Member -NotePropertyName "contentType" -NotePropertyValue $contentType

    $outputFile = Join-Path $outputDir ("{0}.json" -f $day)
    $payload | ConvertTo-Json -Depth 3 | Set-Content -Encoding utf8 -Path $outputFile
    Write-Output "Day $day encrypted -> $outputFile"

    $seenDays[$day] = $true
}

if ($seenDays.Count -ne 24) {
    Write-Warning "Processed $($seenDays.Count) entries. Ensure you have 24 rows for a full calendar."
} else {
    Write-Output "All 24 images encrypted successfully into $outputDir."
}
