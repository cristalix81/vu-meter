[CmdletBinding()]
param([string]$InstallDirectory = '')
$ErrorActionPreference = 'Stop'
function FileHash([string]$File) { (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant() }
try {
  $BundleDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
  $Manifest = Get-Content -LiteralPath (Join-Path $BundleDirectory 'update-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $Payload = Join-Path $BundleDirectory 'payload\app.asar'
  if ($Manifest.product -ne 'Audio Visualizer Pro' -or $Manifest.version -ne '4.2.41' -or $Manifest.baseVersion -ne '4.2.40') { throw 'Unexpected update manifest.' }
  if ((Get-Item -LiteralPath $Payload).Length -ne $Manifest.bytes -or (FileHash $Payload) -ne $Manifest.newAppSha256) { throw 'Update payload checksum is invalid. Download the complete update again.' }
  if (-not $InstallDirectory) {
    # A copied update may be placed inside the existing application directory.
    $ParentDirectory = Split-Path -Parent $BundleDirectory
    if (Test-Path -LiteralPath (Join-Path $ParentDirectory 'Audio Visualizer Pro.exe')) { $InstallDirectory = $ParentDirectory }
    elseif (Test-Path -LiteralPath (Join-Path $BundleDirectory 'Audio Visualizer Pro.exe')) { $InstallDirectory = $BundleDirectory }
    else {
      Add-Type -AssemblyName System.Windows.Forms
      $Picker = New-Object System.Windows.Forms.OpenFileDialog
      $Picker.Title = 'Select the existing Audio Visualizer Pro.exe (version 4.2.40)'
      $Picker.Filter = 'Audio Visualizer Pro|Audio Visualizer Pro.exe'
      $Picker.CheckFileExists = $true
      if ($Picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { Write-Host 'Update cancelled. No changes made.'; exit 0 }
      $InstallDirectory = Split-Path -Parent $Picker.FileName
    }
  }
  $InstallDirectory = (Resolve-Path -LiteralPath $InstallDirectory).Path
  $Executable = Join-Path $InstallDirectory 'Audio Visualizer Pro.exe'
  $InstalledAsar = Join-Path $InstallDirectory 'resources\app.asar'
  if (-not (Test-Path -LiteralPath $Executable -PathType Leaf) -or -not (Test-Path -LiteralPath $InstalledAsar -PathType Leaf)) { throw 'The selected directory is not the existing portable application.' }
  $CurrentHash = FileHash $InstalledAsar
  if ($CurrentHash -eq $Manifest.newAppSha256) { Write-Host 'Version 4.2.41 is already installed.'; exit 0 }
  if ($CurrentHash -ne $Manifest.baseAppSha256) { throw 'This update is for the original 4.2.40 app.asar. The installed file differs; it was left unchanged.' }
  $Running = @(Get-Process -Name ([System.IO.Path]::GetFileNameWithoutExtension($Executable)) -ErrorAction SilentlyContinue | Where-Object { $_.Path -and [string]::Equals($_.Path, $Executable, [System.StringComparison]::OrdinalIgnoreCase) })
  if ($Running.Count) { throw 'Close Audio Visualizer Pro before updating, then run UPDATE_PROGRAM.cmd again.' }
  if ((FileHash $Executable) -ne $Manifest.windowsExeSha256) { throw 'The executable differs from the supplied 4.2.40 release. It was left unchanged.' }
  $Resources = Split-Path -Parent $InstalledAsar
  $Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $BackupDirectory = Join-Path $InstallDirectory 'UpdateBackup'
  New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
  $Backup = Join-Path $BackupDirectory ('app-4.2.40-' + $Stamp + '-' + [Guid]::NewGuid().ToString('N').Substring(0,6) + '.asar')
  Copy-Item -LiteralPath $InstalledAsar -Destination $Backup -ErrorAction Stop
  if ((FileHash $Backup) -ne $CurrentHash) { throw 'Backup verification failed. Update stopped.' }
  $Temporary = Join-Path $Resources ('app.asar.update-' + [Guid]::NewGuid().ToString('N'))
  try {
    Copy-Item -LiteralPath $Payload -Destination $Temporary -ErrorAction Stop
    if ((FileHash $Temporary) -ne $Manifest.newAppSha256) { throw 'Copied payload verification failed.' }
    # Same-volume atomic replacement; the verified backup remains outside resources.
    [System.IO.File]::Replace($Temporary, $InstalledAsar, $null, $true)
    if ((FileHash $InstalledAsar) -ne $Manifest.newAppSha256) { throw 'Installed checksum failed. Restore the backup before launching.' }
  } finally { if ($Temporary -and (Test-Path -LiteralPath $Temporary)) { Remove-Item -LiteralPath $Temporary -Force -ErrorAction SilentlyContinue } }
  Write-Host ('Updated successfully to ' + $Manifest.version + '.')
  Write-Host ('Backup: ' + $Backup)
  Write-Host 'Skins, audio-input settings and profiles were not deleted.'
  Write-Host 'Launch Audio Visualizer Pro.exe normally.'
  exit 0
} catch {
  Write-Host ('Update error: ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'Close the application and check write access to its directory.'
  exit 1
}
