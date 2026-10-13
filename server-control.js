// 서버 상태 확인 / 중지 도우미.
// 배치 파일에 한글을 넣으면 명령창 인코딩 때문에 깨지므로 안내 문구는 전부 여기서 출력한다.
// 사용법: node server-control.js status | stop
const http = require('http');
const os = require('os');
const { execSync } = require('child_process');

const PORT = 3000;
const command = (process.argv[2] || 'status').toLowerCase();

function line() {
  console.log('--------------------------------------------');
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(net => net && net.family === 'IPv4' && !net.internal)
    .map(net => net.address);
}

// 3000번 포트를 쓰고 있는 프로세스 번호를 찾는다.
function findServerPids() {
  try {
    const output = execSync('netstat -ano -p TCP', { encoding: 'utf-8' });
    const pids = new Set();
    output.split(/\r?\n/).forEach(row => {
      const parts = row.trim().split(/\s+/);
      if (parts.length < 5) return;
      const [, local, , state, pid] = parts;
      if (state === 'LISTENING' && local.endsWith(':' + PORT)) pids.add(pid);
    });
    return [...pids];
  } catch {
    return [];
  }
}

function checkAlive() {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${PORT}/api/inspections`, res => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
  });
}

(async () => {
  console.log('');
  line();

  if (command === 'stop') {
    console.log(' 검사성적서 서버 중지');
    line();
    console.log('');
    const pids = findServerPids();
    if (!pids.length) {
      console.log('  이미 꺼져 있습니다.');
    } else {
      pids.forEach(pid => {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
          console.log('  서버를 껐습니다.');
        } catch {
          console.log('  서버를 끄지 못했습니다. (프로세스 번호 ' + pid + ')');
        }
      });
      console.log('');
      console.log('  다시 켜려면 PC를 재시작하거나');
      console.log('  바탕화면의 "검사성적서 서버 시작" 을 더블클릭하세요.');
    }
    console.log('');
    line();
    return;
  }

  console.log(' 검사성적서 서버 상태');
  line();
  console.log('');
  const alive = await checkAlive();
  if (alive) {
    console.log('  [켜져 있음] 검사성적서를 등록·수정할 수 있습니다.');
    console.log('');
    console.log('    이 PC에서    :  http://localhost:' + PORT);
    lanAddresses().forEach(address => {
      console.log('    사내 다른 PC :  http://' + address + ':' + PORT);
    });
  } else {
    console.log('  [꺼져 있음] 지금은 등록·수정을 할 수 없습니다.');
    console.log('');
    console.log('    바탕화면의 "검사성적서 서버 시작" 을 더블클릭하세요.');
  }
  console.log('');
  console.log('  ※ 동료들이 보는 GitHub 공개 페이지는 서버와 무관하게 항상 열립니다.');
  console.log('');
  line();
})();
