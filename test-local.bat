@echo off
rem Double-click to start a local copy of AUNA with fake data (nothing touches production).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\test-local.ps1"
pause
