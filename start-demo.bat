@echo off
cd /d "%~dp0"
title Victory Check demo
echo.
echo   Starting Victory Check demo...
echo   Admin:  http://localhost:4000/admin/
echo   Mobile: http://localhost:4000/mobile/
echo   Login:  admin@demo.local / 123
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-demo.ps1"
echo.
echo   Site stopped.
pause
