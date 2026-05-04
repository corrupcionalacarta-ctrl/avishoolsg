# AVI School - Registra dos tareas en Windows Task Scheduler
# Ejecuta como tu usuario normal (no requiere admin si es Trigger=user logged on)
#
# Uso:
#   .\register_scheduled_tasks.ps1
#
# Para ver/borrar despues:
#   Get-ScheduledTask -TaskName "AVI School*"
#   Unregister-ScheduledTask -TaskName "AVI School Morning" -Confirm:$false

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$morningBat = Join-Path $here "daily_morning.bat"
$eveningBat = Join-Path $here "daily_evening.bat"

if (!(Test-Path $morningBat)) { Write-Error "No existe $morningBat"; exit 1 }
if (!(Test-Path $eveningBat)) { Write-Error "No existe $eveningBat"; exit 1 }

# === MORNING: 6:30 AM ===
$morningTrigger = New-ScheduledTaskTrigger -Daily -At "06:30"
$morningAction = New-ScheduledTaskAction -Execute $morningBat -WorkingDirectory $here
$morningSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 15)

Register-ScheduledTask `
    -TaskName "AVI School Morning" `
    -Description "Pipeline matutino: gmail+classroom+schoolnet+digest" `
    -Trigger $morningTrigger `
    -Action $morningAction `
    -Settings $morningSettings `
    -Force

Write-Host "[OK] Registrada: AVI School Morning (06:30 daily)"

# === EVENING: 18:30 PM ===
$eveningTrigger = New-ScheduledTaskTrigger -Daily -At "18:30"
$eveningAction = New-ScheduledTaskAction -Execute $eveningBat -WorkingDirectory $here
$eveningSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 10)

Register-ScheduledTask `
    -TaskName "AVI School Evening" `
    -Description "Pipeline vespertino: gmail + digest" `
    -Trigger $eveningTrigger `
    -Action $eveningAction `
    -Settings $eveningSettings `
    -Force

Write-Host "[OK] Registrada: AVI School Evening (18:30 daily)"
Write-Host ""
Write-Host "Ver estado:"
Write-Host "  Get-ScheduledTask -TaskName 'AVI School*' | Get-ScheduledTaskInfo"
Write-Host ""
Write-Host "Forzar correr una ya:"
Write-Host "  Start-ScheduledTask -TaskName 'AVI School Morning'"
