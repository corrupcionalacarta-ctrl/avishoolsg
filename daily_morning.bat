@echo off
REM AVI School - Pipeline matutino (Task Scheduler invoca este .bat)
REM Auto-cwd al folder del proyecto, activa venv, corre run_all morning

cd /d "%~dp0"
call .venv\Scripts\activate.bat
python run_all.py --morning >> "run_all_stdout_%DATE:~6,4%%DATE:~3,2%%DATE:~0,2%.log" 2>&1
exit /b %ERRORLEVEL%
