@echo off
rem Double-click to publish AUNA changes (website, functions, rules).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\deploy.ps1" %*
echo.
pause
