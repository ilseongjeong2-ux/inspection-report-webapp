// 사내 대시보드를 그대로 복사해 GitHub Pages 용 "읽기 전용 쌍둥이 페이지"를 만든다.
//
// 복사본을 손으로 관리하면 로컬 화면을 고칠 때마다 공개 페이지가 뒤처지므로,
// 갱신할 때마다 public/ 의 실제 화면에서 다시 만들어 낸다. (항상 같은 화면이 유지된다)
//
// 서버가 없는 곳이라 등록·수정·삭제는 막고, 데이터는 API 대신 data.json 에서 읽도록 바꾼다.
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC_DB = path.join(ROOT, 'data', 'inspections.json');
const SRC_SCHEDULED = path.join(ROOT, 'data', 'scheduled.json');
const SRC_UPLOADS = path.join(ROOT, 'data', 'uploads');
const SRC_PUBLIC = path.join(ROOT, 'public');

// GitHub Pages는 저장소 최상위 또는 docs 폴더만 게시할 수 있어서 폴더 이름이 docs 이다.
const OUT_DIR = path.join(ROOT, 'docs');
const OUT_PHOTOS = path.join(OUT_DIR, 'photos');
const OUT_DATA = path.join(OUT_DIR, 'data.json');
const OUT_SCHEDULED = path.join(OUT_DIR, 'scheduled.json');

const notes = [];

// ---- 문자열 치환 도우미 ----
// 화면 코드가 바뀌어 치환에 실패하면 공개 페이지가 조용히 망가지므로, 중요한 것은 즉시 중단한다.
function mustReplace(text, from, to, what) {
  const count = text.split(from).length - 1;
  if (count !== 1) {
    throw new Error(
      `공개 페이지를 만들지 못했습니다. (${what})\n` +
      `       화면 코드가 바뀌어 자동 변환이 맞지 않습니다. 도움을 요청해 주세요.`
    );
  }
  return text.replace(from, to);
}
function tryReplace(text, from, to, what) {
  if (text.split(from).length - 1 !== 1) {
    notes.push(`건너뜀: ${what}`);
    return text;
  }
  return text.replace(from, to);
}

// ---- 사진 경로 ----
// 사내 서버에서는 /uploads/... 로 제공되지만 공개 페이지에서는 photos/... 로 옮겨 담는다.
function toPublicPhotoUrl(url) {
  return typeof url === 'string' && url.startsWith('/uploads/')
    ? 'photos/' + url.slice('/uploads/'.length)
    : url;
}
function mapPhotoUrls(list) {
  return (list || []).map(toPublicPhotoUrl);
}

function toPublicRecord(record) {
  const items = (Array.isArray(record.items) && record.items.length)
    ? record.items
    : [{
        itemName: record.itemName, color: record.color, lotNo: record.lotNo,
        quantity: record.quantity, result: record.result,
        defectDetail: record.defectDetail, remarks: '',
        photoUrls: record.photoUrls, defectPhotoUrls: record.defectPhotoUrls
      }];
  return {
    ...record,
    items: items.map(item => ({
      ...item,
      photoUrls: mapPhotoUrls(item.photoUrls),
      defectPhotoUrls: mapPhotoUrls(item.defectPhotoUrls)
    })),
    photoUrls: mapPhotoUrls(record.photoUrls),
    defectPhotoUrls: mapPhotoUrls(record.defectPhotoUrls)
  };
}

// ---- 사진 파일 동기화 ----
// 필요한 사진은 docs/photos 로 복사하고, 삭제된 성적서의 사진은 함께 지운다.
function listFilesRecursively(dir, base) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    const rel = base ? base + '/' + entry.name : entry.name;
    return entry.isDirectory() ? listFilesRecursively(full, rel) : [rel];
  });
}

function syncPhotos(records) {
  const needed = new Set();
  records.forEach(record => {
    record.items.forEach(item => {
      [...(item.photoUrls || []), ...(item.defectPhotoUrls || [])].forEach(url => {
        if (url.startsWith('photos/')) needed.add(url.slice('photos/'.length));
      });
    });
  });

  let copied = 0;
  needed.forEach(rel => {
    const from = path.join(SRC_UPLOADS, rel);
    const to = path.join(OUT_PHOTOS, rel);
    if (!fs.existsSync(from)) {
      notes.push('원본 사진을 찾지 못했습니다: ' + rel);
      return;
    }
    const fromStat = fs.statSync(from);
    const upToDate = fs.existsSync(to) && fs.statSync(to).size === fromStat.size;
    if (upToDate) return;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    copied += 1;
  });

  let removed = 0;
  listFilesRecursively(OUT_PHOTOS, '').forEach(rel => {
    if (needed.has(rel)) return;
    fs.unlinkSync(path.join(OUT_PHOTOS, rel));
    removed += 1;
  });

  return { total: needed.size, copied, removed };
}

// ---- 대시보드 화면을 읽기 전용으로 바꾸기 ----
const READONLY_STYLE = `
<style>
  /* 공개(읽기 전용) 페이지 — 서버가 없으므로 등록/수정/삭제 관련 요소를 감춘다 */
  button[onclick*="openRegisterModal"],
  button[onclick*="openScheduleRegisterModal"],
  button[onclick*="csvFileInput"],
  .row-actions,
  .gallery-card .info .actions,
  #registerModal,
  #scheduleRegisterModal { display: none !important; }

  /* 목록 맨 오른쪽 '관리' 열은 등록/수정/삭제 전용이므로 열 자체를 숨긴다 */
  #listView table th:last-child,
  #listView table td:last-child { display: none !important; }

  .readonly-tag {
    display: inline-block; margin-left: 10px; padding: 4px 10px; border-radius: 999px;
    background: #eef1f7; color: #6b7280; font-size: 12px; font-weight: 700; vertical-align: middle;
  }
  .export-stamp { font-size: 12px; color: #7c8494; margin-left: 10px; }
</style>
`;

const READONLY_GUARD = `
<script>
  // 공개 페이지에는 서버가 없다. 실수로 눌리더라도 안내만 하고 아무 일도 일어나지 않게 한다.
  [
    'openRegisterModal', 'openEditModal', 'duplicateRecord', 'deleteRecord',
    'openScheduleRegisterModal', 'openScheduleEditModal', 'deleteScheduledItem', 'importCsv'
  ].forEach(function (name) {
    window[name] = function () {
      alert('이 페이지는 조회 전용입니다.\\n등록과 수정은 사내 검사성적서 프로그램에서 해주세요.');
    };
  });
</script>
`;

function buildIndexPage() {
  let html = fs.readFileSync(path.join(SRC_PUBLIC, 'index.html'), 'utf-8');

  // 데이터를 서버 API 대신 data.json 에서 읽는다.
  html = mustReplace(html, `fetch('/api/inspections')`, `fetch('data.json?t=' + Date.now())`, '검사 데이터 읽기');
  html = mustReplace(html,
    `      allRecords = await res.json();`,
    `      const payload = await res.json();
      allRecords = Array.isArray(payload) ? payload : (payload.records || []);
      if (payload && payload.exportedAt) {
        const stamp = document.getElementById('exportStamp');
        if (stamp) stamp.textContent = '데이터 기준: ' + payload.exportedAt.slice(0, 16).replace('T', ' ');
      }`,
    '검사 데이터 담기');
  html = mustReplace(html, `fetch('/api/scheduled')`, `fetch('scheduled.json?t=' + Date.now())`, '입고예정 읽기');

  // 제목을 조회용으로 바꾸고 읽기 전용임을 표시한다.
  html = tryReplace(html,
    `<title>검사성적서 관리 대시보드</title>`,
    `<title>검사성적서 조회</title>`,
    '문서 제목');
  html = tryReplace(html,
    `  <h1>검사성적서 관리</h1>`,
    `  <h1>검사성적서 조회<span class="readonly-tag">읽기 전용</span><span class="export-stamp" id="exportStamp"></span></h1>`,
    '화면 제목');

  html = mustReplace(html, '</head>', READONLY_STYLE + '</head>', '읽기 전용 스타일 넣기');
  html = mustReplace(html, '</body>', READONLY_GUARD + '</body>', '읽기 전용 잠금 넣기');
  return html;
}

function buildReportPage() {
  let html = fs.readFileSync(path.join(SRC_PUBLIC, 'report.html'), 'utf-8');

  // 성적서 한 건을 서버에서 받아오던 것을 data.json 에서 찾도록 바꾼다.
  html = mustReplace(html,
    `      const res = await fetch(\`/api/inspections/\${id}\`);
      if (!res.ok) throw new Error('문서를 찾을 수 없습니다.');
      const r = await res.json();`,
    `      const res = await fetch('data.json?t=' + Date.now());
      if (!res.ok) throw new Error('데이터를 불러오지 못했습니다.');
      const payload = await res.json();
      const list = Array.isArray(payload) ? payload : (payload.records || []);
      const r = list.find(x => x.id === id);
      if (!r) throw new Error('문서를 찾을 수 없습니다.');`,
    '성적서 한 건 읽기');
  return html;
}

function copyIfChanged(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size) return;
  fs.copyFileSync(from, to);
}

function writeIfChanged(file, content) {
  let previous = null;
  try { previous = fs.readFileSync(file, 'utf-8'); } catch { previous = null; }
  if (previous === content) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf-8');
  return true;
}

function main() {
  // 공개 페이지는 문서번호 최신순(최근 것이 위)으로 보여 준다.
  // 등록 순서가 아니라 문서번호로 정렬하므로 날짜를 거슬러 등록해도 자리가 어긋나지 않는다.
  const records = JSON.parse(fs.readFileSync(SRC_DB, 'utf-8'))
    .map(toPublicRecord)
    .sort((a, b) => {
      const noA = a.inspectionNo || '';
      const noB = b.inspectionNo || '';
      if (noA !== noB) return noA < noB ? 1 : -1;
      return (a.inspectionDate || '') < (b.inspectionDate || '') ? 1 : -1;
    });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(OUT_PHOTOS, { recursive: true });

  // 검사 내용이 그대로면 data.json 을 다시 쓰지 않는다. (의미 없는 갱신 기록이 쌓이지 않도록)
  let previousRecords = null;
  try { previousRecords = JSON.parse(fs.readFileSync(OUT_DATA, 'utf-8')).records; } catch { previousRecords = null; }
  const dataUnchanged = previousRecords && JSON.stringify(previousRecords) === JSON.stringify(records);
  if (!dataUnchanged) {
    fs.writeFileSync(OUT_DATA, JSON.stringify({
      exportedAt: new Date().toISOString(),
      records
    }, null, 2), 'utf-8');
  }

  let scheduled = [];
  try { scheduled = JSON.parse(fs.readFileSync(SRC_SCHEDULED, 'utf-8')); } catch { scheduled = []; }
  writeIfChanged(OUT_SCHEDULED, JSON.stringify(scheduled, null, 2));

  const photos = syncPhotos(records);

  // 화면은 항상 로컬 화면에서 다시 만들어 낸다.
  writeIfChanged(path.join(OUT_DIR, 'index.html'), buildIndexPage());
  writeIfChanged(path.join(OUT_DIR, 'report.html'), buildReportPage());
  writeIfChanged(path.join(OUT_DIR, '.nojekyll'), '');
  copyIfChanged(path.join(SRC_PUBLIC, 'fursys-logo.png'), path.join(OUT_DIR, 'fursys-logo.png'));
  ['html2canvas.min.js', 'jspdf.umd.min.js'].forEach(name => {
    copyIfChanged(path.join(SRC_PUBLIC, 'vendor', name), path.join(OUT_DIR, 'vendor', name));
  });

  const itemCount = records.reduce((sum, r) => sum + r.items.length, 0);
  if (dataUnchanged) {
    console.log('      검사 데이터는 변경되지 않았습니다.');
  } else {
    console.log(`      내보내기 완료: 성적서 ${records.length}건 / 품목 ${itemCount}개`);
  }
  console.log(`      사진 ${photos.total}장 (새로 복사 ${photos.copied}장, 정리 ${photos.removed}장)`);
  console.log('      공개 화면을 사내 대시보드에서 다시 만들었습니다.');
  notes.forEach(note => console.log('      · ' + note));
}

main();
