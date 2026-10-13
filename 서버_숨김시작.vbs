' 검사성적서 서버를 창 없이 실행한다.
' 작업 스케줄러가 로그인할 때 이 파일을 실행하도록 등록되어 있다.
' 창이 없으므로 서버가 남기는 메시지는 server_log.txt 에 쌓인다.
Dim shell, folder
Set shell = CreateObject("WScript.Shell")
folder = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = folder
' 두 번째 인자 0 = 창 숨김, 세 번째 False = 기다리지 않고 바로 반환
shell.Run "cmd /c node server.js >> server_log.txt 2>&1", 0, False
