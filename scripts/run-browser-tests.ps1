param(
  [int]$ServerPort = 8124,
  [int]$DebugPort = 9223,
  [string]$BaseUrl = '',
  [string]$XlsxPath = 'H:\CarIdentify\pegion_Car_Identfy.xlsx',
  [string]$CsvPath = 'H:\CarIdentify\Pegion_Freeway_ETC_Record.csv',
  [string]$IdkcityPath = 'H:\CarIdentify\Pegion_IDKCity_Car_Identfy.xlsx',
  [string]$CombinedCoordPath = '',
  [string[]]$Cases = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
  $BaseUrl = "http://127.0.0.1:$ServerPort/"
}

function Get-CommandPath([string[]]$Names) {
  foreach ($name in $Names) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($command) {
      return $command.Source
    }
  }
  return $null
}

function Get-EdgePath {
  $candidates = @(
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }
  throw 'Could not find Microsoft Edge.'
}

function Wait-HttpOk([string]$Url, [int]$TimeoutSeconds = 20) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return
      }
    } catch {
      Start-Sleep -Milliseconds 250
      continue
    }
    Start-Sleep -Milliseconds 250
  }
  throw "Timed out waiting for $Url"
}

function Stop-EdgeForProfile([string]$ProfileDir) {
  $escaped = [Regex]::Escape($ProfileDir)
  $processes = Get-CimInstance Win32_Process -Filter "name = 'msedge.exe'"
  foreach ($process in $processes) {
    if ($process.CommandLine -and $process.CommandLine -match $escaped) {
      try {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
      } catch {
      }
    }
  }
}

function Invoke-EdgeCase(
  [string]$CaseName,
  [string]$ProfileDir,
  [string]$EdgePath,
  [string]$NodePath,
  [string]$ResolvedXlsx,
  [string]$ResolvedCsv,
  [string]$ResolvedIdkcity,
  [string]$ResolvedCombinedCoord
) {
  if (Test-Path $ProfileDir) {
    Remove-Item -LiteralPath $ProfileDir -Recurse -Force
  }

  $edgeArgs = @(
    '--headless',
    '--disable-gpu',
    '--no-first-run',
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
    "--remote-debugging-port=$DebugPort",
    "--user-data-dir=$ProfileDir",
    $BaseUrl
  )

  $edgeProcess = $null
  try {
    $edgeProcess = Start-Process -FilePath $EdgePath -ArgumentList $edgeArgs -WorkingDirectory $repoRoot -PassThru
    Wait-HttpOk -Url "http://127.0.0.1:$DebugPort/json/version" -TimeoutSeconds 20

    $nodeArgs = @(
      "$repoRoot\scripts\browser-cdp-tests.mjs",
      '--base-url', $BaseUrl,
      '--debug-port', $DebugPort,
      '--xlsx', $ResolvedXlsx,
      '--csv', $ResolvedCsv,
      '--idkcity', $ResolvedIdkcity,
      '--case', $CaseName
    )
    if (-not [string]::IsNullOrWhiteSpace($ResolvedCombinedCoord)) {
      $nodeArgs += @('--combined-coord', $ResolvedCombinedCoord)
    }

    & $NodePath @nodeArgs 2>&1 | ForEach-Object { Write-Host $_ }

    return $LASTEXITCODE
  } finally {
    if ($edgeProcess -and -not $edgeProcess.HasExited) {
      try {
        Stop-Process -Id $edgeProcess.Id -Force -ErrorAction Stop
      } catch {
      }
    }
    Stop-EdgeForProfile -ProfileDir $ProfileDir
    Start-Sleep -Milliseconds 300
    if (Test-Path $ProfileDir) {
      try {
        Remove-Item -LiteralPath $ProfileDir -Recurse -Force -ErrorAction Stop
      } catch {
      }
    }
  }
}

$pythonPath = Get-CommandPath @('python', 'py')
if (-not $pythonPath) {
  throw 'Could not find python or py launcher.'
}

$nodePath = Get-CommandPath @('node')
if (-not $nodePath) {
  throw 'Could not find node.'
}

$edgePath = Get-EdgePath

function Resolve-OptionalPath([string]$PathValue) {
  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    return ''
  }
  if (Test-Path -LiteralPath $PathValue) {
    return (Resolve-Path -LiteralPath $PathValue).Path
  }
  return $PathValue
}

$resolvedXlsx = Resolve-OptionalPath $XlsxPath
$resolvedCsv = Resolve-OptionalPath $CsvPath
$resolvedIdkcity = Resolve-OptionalPath $IdkcityPath
$resolvedCombinedCoord = Resolve-OptionalPath $CombinedCoordPath

$pythonArgs = if ((Split-Path $pythonPath -Leaf).ToLowerInvariant() -eq 'py.exe') {
  @('-3', '-m', 'http.server', $ServerPort)
} else {
  @('-m', 'http.server', $ServerPort)
}

$pythonProcess = $null
$standardCases = @('startup-dom', 'xlsx-single', 'csv-single', 'merged-upload', 'idkcity-single')
$hasStandardFiles = (Test-Path -LiteralPath $XlsxPath) -and (Test-Path -LiteralPath $CsvPath) -and (Test-Path -LiteralPath $IdkcityPath)
if ($Cases.Count -gt 0) {
  $cases = $Cases
} elseif ($hasStandardFiles) {
  $cases = $standardCases
} else {
  $cases = @('startup-dom')
}
if (-not [string]::IsNullOrWhiteSpace($resolvedCombinedCoord) -and $cases -notcontains 'combined-coordinate-sensitive') {
  $cases += 'combined-coordinate-sensitive'
}
$results = @()

try {
  $pythonProcess = Start-Process -FilePath $pythonPath -ArgumentList $pythonArgs -WorkingDirectory $repoRoot -PassThru
  Wait-HttpOk -Url $BaseUrl -TimeoutSeconds 20

  foreach ($caseName in $cases) {
    $profileDir = Join-Path $repoRoot (".tmp-edge-test-" + $caseName)
    $exitCode = Invoke-EdgeCase `
      -CaseName $caseName `
      -ProfileDir $profileDir `
      -EdgePath $edgePath `
      -NodePath $nodePath `
      -ResolvedXlsx $resolvedXlsx `
      -ResolvedCsv $resolvedCsv `
      -ResolvedIdkcity $resolvedIdkcity `
      -ResolvedCombinedCoord $resolvedCombinedCoord
    $results += [pscustomobject]@{
      CaseName = $caseName
      ExitCode = $exitCode
    }
  }

  $failed = @($results | Where-Object { $_.ExitCode -ne 0 })
  Write-Host ("WRAPPER SUMMARY {0}/{1} passed" -f ($results.Count - $failed.Count), $results.Count)
  if ($failed.Count -gt 0) {
    exit 1
  }
  exit 0
} finally {
  if ($pythonProcess -and -not $pythonProcess.HasExited) {
    try {
      Stop-Process -Id $pythonProcess.Id -Force -ErrorAction Stop
    } catch {
    }
  }
}
