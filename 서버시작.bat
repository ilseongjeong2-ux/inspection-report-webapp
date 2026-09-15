@echo off
title Inspection Report Server
cd /d "%~dp0"
node server.js
echo.
echo *** Server stopped ***
pause
