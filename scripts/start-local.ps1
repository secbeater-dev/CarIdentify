param(
  [int]$Port = 8000,
  [switch]$NoBrowser
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = 'H:\CarIdentify\CarIdentify'
if (-not (Test-Path -LiteralPath $repoRoot)) {
  throw "Project directory not found: $repoRoot"
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

function Wait-ServerReady([string]$Url, [System.Diagnostics.Process]$Process, [int]$TimeoutSeconds = 20) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastError = $null
  while ((Get-Date) -lt $deadline) {
    if ($Process.HasExited) {
      throw "HTTP server exited early with code $($Process.ExitCode). Please check whether port $Port is already in use."
    }

    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return
      }
    } catch {
      $lastError = $_
    }

    Start-Sleep -Milliseconds 250
  }

  if ($lastError) {
    throw "Timed out waiting for $Url. Last error: $($lastError.Exception.Message)"
  }
  throw "Timed out waiting for $Url"
}

$pythonPath = Get-CommandPath @('python', 'py')
if (-not $pythonPath) {
  throw 'Could not find python or py launcher. Please install Python first.'
}

$pythonExeName = (Split-Path $pythonPath -Leaf).ToLowerInvariant()
$pythonArgs = if ($pythonExeName -eq 'py.exe') {
  @('-3', '-m', 'http.server', $Port)
} else {
  @('-m', 'http.server', $Port)
}

$baseUrl = "http://127.0.0.1:$Port/"
$serverProcess = $null

try {
  Write-Host "Starting local server at $baseUrl" -ForegroundColor Cyan
  $serverProcess = Start-Process -FilePath $pythonPath -ArgumentList $pythonArgs -WorkingDirectory $repoRoot -PassThru
  Wait-ServerReady -Url $baseUrl -Process $serverProcess -TimeoutSeconds 20

  Write-Host "Serving: $repoRoot" -ForegroundColor Green
  Write-Host "Press Ctrl+C to stop the server." -ForegroundColor Yellow

  if (-not $NoBrowser) {
    Start-Process $baseUrl | Out-Null
  }

  while (-not $serverProcess.HasExited) {
    Start-Sleep -Seconds 1
  }

  if ($serverProcess.ExitCode -ne 0) {
    exit $serverProcess.ExitCode
  }
} finally {
  if ($serverProcess -and -not $serverProcess.HasExited) {
    try {
      Stop-Process -Id $serverProcess.Id -Force -ErrorAction Stop
    } catch {
    }
  }
}
