@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo 검사성적서 서버를 시작합니다...
echo 종료하려면 이 창을 닫으면 됩니다.
powershell -NoProfile -Command "node server.js 2>&1 | Tee-Object -FilePath 'server_log.txt'"
pause
