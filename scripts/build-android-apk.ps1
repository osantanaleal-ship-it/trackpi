$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$localJavaRoot = Join-Path $projectRoot '.tools\temurin21'
$localJavaHome = Get-ChildItem -LiteralPath $localJavaRoot -Directory -ErrorAction SilentlyContinue |
  Where-Object { Test-Path (Join-Path $_.FullName 'bin\java.exe') } |
  Select-Object -First 1 -ExpandProperty FullName

$javaCandidates = @(
  $localJavaHome
  $env:JAVA_HOME
  'C:\Program Files\Android\Android Studio\jbr'
) | Where-Object { $_ -and (Test-Path (Join-Path $_ 'bin\java.exe')) }

$javaHome = $javaCandidates | Select-Object -First 1
if (-not $javaHome) {
  throw 'Hace falta Java 21. Instala Temurin 21 en .tools\temurin21 o configura JAVA_HOME.'
}

$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = 'C:\Android\sdk'
$env:ANDROID_SDK_ROOT = 'C:\Android\sdk'

Push-Location $projectRoot
try {
  npm run android:sync
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo sincronizar Android.' }

  Push-Location (Join-Path $projectRoot 'android')
  try {
    .\gradlew.bat assembleDebug --no-daemon --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo compilar el APK.' }
  }
  finally {
    Pop-Location
  }

  $sourceApk = Join-Path $projectRoot 'android\app\build\outputs\apk\debug\app-debug.apk'
  $deliverables = Join-Path $projectRoot 'deliverables'
  $targetApk = Join-Path $deliverables 'Trackpi-Android.apk'
  New-Item -ItemType Directory -Force -Path $deliverables | Out-Null
  Copy-Item -LiteralPath $sourceApk -Destination $targetApk -Force

  $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $targetApk
  Write-Host "APK creado: $targetApk"
  Write-Host "SHA-256: $($hash.Hash)"
}
finally {
  Pop-Location
}
