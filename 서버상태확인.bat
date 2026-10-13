@echo off
cd /d "%~dp0"
node server-control.js status
pause
