@echo off
setlocal EnableExtensions
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Node.js LTS required to build Electron EXE.
 echo START_PROGRAM.bat runs the program immediately with no build.
 pause
 exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (echo npm not found & pause & exit /b 1)
call npm install --no-fund
if errorlevel 1 goto fail
call npm run check
if errorlevel 1 goto fail
call npm run dist
if errorlevel 1 goto fail
explorer "%cd%\dist"
pause
exit /b 0
:fail
echo BUILD FAILED. Please send the error log.
pause
exit /b 1
