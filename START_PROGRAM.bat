@echo off
setlocal EnableExtensions
cd /d "%~dp0"
rem Launch ready-to-run AVPro directly in a dedicated app window.
rem No npm or compiler is needed. Requires installed Edge or Chrome.
set "HTMLFILE=%~dp0index.html"
set "APPURL=file:///%HTMLFILE:\=/%"
set "BROWSER="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER (
 echo Neither Microsoft Edge nor Google Chrome was found.
 echo Open index.html directly, or install a recent Edge/Chrome.
 pause
 exit /b 1
)
start "Audio Visualizer Pro" "%BROWSER%" --app="%APPURL%" --window-size=1400,840 --new-window
exit /b 0
