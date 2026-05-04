@echo off
REM AVI School - Pipeline vespertino (solo gmail + digest)

cd /d "%~dp0"
call .venv\Scripts\activate.bat
python run_all.py --evening >> "run_all_stdout_%DATE:~6,4%%DATE:~3,2%%DATE:~0,2%.log" 2>&1
exit /b %ERRORLEVEL%
