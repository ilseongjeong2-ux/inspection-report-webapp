// 공개 페이지(GitHub Pages) 갱신 - 깃허브_업데이트.bat 이 이 파일을 실행한다.
// 배치 파일에 한글을 넣으면 Windows 명령창 인코딩 때문에 깨지므로, 안내 문구는 전부 여기서 출력한다.
const { spawnSync } = require('child_process');
const path = require('path');

const CWD = __dirname;

function run(command, args) {
  return spawnSync(command, args, { cwd: CWD, encoding: 'utf-8', shell: false });
}

function line() {
  console.log('--------------------------------------------');
}

function fail(message, detail) {
  line();
  console.log('[중단] ' + message);
  if (detail && detail.trim()) {
    console.log('');
    console.log('자세한 내용:');
    console.log(detail.trim());
  }
  line();
  process.exit(1);
}

console.log('');
line();
console.log(' 검사성적서 공개 페이지 갱신');
line();
console.log('');

// 1. 공개용 데이터 내보내기
console.log('[1/3] 최신 검사 데이터를 공개용으로 내보냅니다...');
const exported = run(process.execPath, [path.join(CWD, 'export-github-data.js')]);
if (exported.status !== 0) {
  fail('데이터를 내보내지 못했습니다.', (exported.stderr || '') + (exported.stdout || ''));
}
process.stdout.write(exported.stdout);
console.log('');

// 2. 변경 내용 기록
console.log('[2/3] 변경된 내용을 기록합니다...');
const added = run('git', ['add', '-A']);
if (added.status !== 0) {
  fail('git 기록에 실패했습니다. 이 폴더가 GitHub와 연결되어 있는지 확인이 필요합니다.', added.stderr);
}

const staged = run('git', ['diff', '--cached', '--quiet']);
if (staged.status === 0) {
  line();
  console.log('[완료] 새로 올릴 변경 사항이 없습니다.');
  console.log('       공개 페이지는 이미 최신 상태입니다.');
  line();
  process.exit(0);
}

const now = new Date();
const stamp = now.getFullYear() + '-' +
  String(now.getMonth() + 1).padStart(2, '0') + '-' +
  String(now.getDate()).padStart(2, '0') + ' ' +
  String(now.getHours()).padStart(2, '0') + ':' +
  String(now.getMinutes()).padStart(2, '0');

const committed = run('git', ['commit', '-m', '데이터 갱신 ' + stamp]);
if (committed.status !== 0) {
  fail('변경 내용을 기록하지 못했습니다.', committed.stderr || committed.stdout);
}
console.log('      기록 완료: ' + stamp);
console.log('');

// 3. GitHub에 올리기
console.log('[3/3] GitHub에 올리는 중입니다...');
const pushed = run('git', ['push']);
if (pushed.status !== 0) {
  const message = (pushed.stderr || '') + (pushed.stdout || '');
  if (/Authentication|denied|credential|403|401/i.test(message)) {
    fail('GitHub 로그인이 풀린 것 같습니다.\n       명령창에 아래를 입력해 다시 로그인한 뒤 이 파일을 다시 실행해 주세요.\n\n       gh auth login', message);
  }
  if (/could not resolve|unable to access|timed out|network/i.test(message)) {
    fail('인터넷 연결 문제로 GitHub에 접속하지 못했습니다.\n       잠시 뒤 다시 시도해 주세요.', message);
  }
  fail('GitHub에 올리지 못했습니다.', message);
}

line();
console.log('[완료] 공개 페이지에 반영되었습니다.');
console.log('');
console.log(' 주소: https://ilseongjeong2-ux.github.io/inspection-report-webapp/');
console.log('');
console.log(' 실제 화면에 나타나기까지 1~2분 걸릴 수 있습니다.');
line();
