@echo off
setlocal EnableExtensions
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0UPDATE_PROGRAM.ps1" %*
set "AVPRO_UPDATE_RESULT=%ERRORLEVEL%"
echo.
if not "%AVPRO_UPDATE_RESULT%"=="0" echo Update failed. The existing program was not intentionally removed. See the message above.
pause
exit /b %AVPRO_UPDATE_RESULT%
