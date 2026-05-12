# AVI School - Registra tareas en Windows Task Scheduler
# Ejecuta como tu usuario normal (no requiere admin)
#
# Uso:
#   .\register_scheduled_tasks.ps1
#
# Ver estado:
#   Get-ScheduledTask -TaskName "AVI School*" | Get-ScheduledTaskInfo
# Forzar una corrida:
#   Start-ScheduledTask -TaskName "AVI School Morning"
# Eliminar:
#   Get-ScheduledTask -TaskName "AVI School*" | Unregister-ScheduledTask -Confirm:$false

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$morningBat = Join-Path $here "daily_morning.bat"
$eveningBat = Join-Path $here "daily_evening.bat"
$botBat     = Join-Path $here "daily_bot.bat"

foreach ($f in @($morningBat, $eveningBat, $botBat)) {
    if (!(Test-Path $f)) { Write-Error "No existe $f"; exit 1 }
}

# === MORNING: 6:30 AM ===
$trigger  = New-ScheduledTaskTrigger -Daily -At "06:30"
$action   = New-ScheduledTaskAction -Execute $morningBat -WorkingDirectory $here
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName "AVI School Morning" `
    -Description "Pipeline matutino: gmail+schoolnet+classroom+digest" `
    -Trigger $trigger -Action $action -Settings $settings -Force
Write-Host "[OK] AVI School Morning - 06:30 diario"

# === EVENING: 18:30 PM ===
$trigger  = New-ScheduledTaskTrigger -Daily -At "18:30"
$action   = New-ScheduledTaskAction -Execute $eveningBat -WorkingDirectory $here
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName "AVI School Evening" `
    -Description "Pipeline vespertino: gmail+digest" `
    -Trigger $trigger -Action $action -Settings $settings -Force
Write-Host "[OK] AVI School Evening - 18:30 diario"

# === TELEGRAM BOT: carpeta Startup (no requiere admin) ===
$startupDir = [System.Environment]::GetFolderPath("Startup")
$shortcut   = Join-Path $startupDir "AVI School Bot.lnk"
$wsh  = New-Object -ComObject WScript.Shell
$link = $wsh.CreateShortcut($shortcut)
$link.TargetPath       = $botBat
$link.WorkingDirectory = $here
$link.WindowStyle      = 7   # minimizado
$link.Description      = "AVI School Telegram Bot"
$link.Save()
Write-Host "[OK] AVI School Bot - acceso directo en Startup (arranca con Windows)"

Write-Host ""
Write-Host "Tareas registradas:"
Get-ScheduledTask -TaskName "AVI School*" | Format-Table TaskName, State -AutoSize

Write-Host ""
Write-Host "Para iniciar el bot AHORA:"
Write-Host "  Start-Process '$botBat'"
