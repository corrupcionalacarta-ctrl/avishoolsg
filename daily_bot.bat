@echo off
REM AVI School - Telegram Bot (se mantiene corriendo)
REM Task Scheduler lo inicia al loguearse y lo reinicia si cae

cd /d "%~dp0"
call .venv\Scripts\activate.bat
:loop
python telegram_bot.py
echo [%DATE% %TIME%] Bot termino, reiniciando en 10s...
timeout /t 10 /nobreak >nul
goto loop
