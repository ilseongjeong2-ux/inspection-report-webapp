@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo ============================================
echo  GitHub 공개 페이지 갱신
echo ============================================
echo.

echo [1/3] 최신 검사 데이터를 공개용으로 내보내는 중...
node export-github-data.js
if errorlevel 1 goto ERROR
echo.

echo [2/3] 변경 내용 기록 중...
git add -A
git diff --cached --quiet
if not errorlevel 1 (
  echo   변경된 내용이 없습니다. 올릴 것이 없습니다.
  goto DONE
)
git commit -m "데이터 갱신 %date% %time%"
if errorlevel 1 goto ERROR
echo.

echo [3/3] GitHub에 올리는 중...
git push
if errorlevel 1 goto ERROR
echo.
echo 완료되었습니다. 공개 페이지에 반영되기까지 1~2분 걸릴 수 있습니다.
goto DONE

:ERROR
echo.
echo *** 문제가 생겨 중단했습니다. 위 메시지를 확인해 주세요. ***

:DONE
echo.
pause
