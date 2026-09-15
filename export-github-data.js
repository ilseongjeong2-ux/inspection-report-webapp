// 사내 서버의 검사 데이터에서 "공개해도 되는 요약"만 뽑아 docs/data.json 으로 내보낸다.
// 공개 페이지이므로 사진, 불량내용, Lot No., 검사의뢰서/ERP 링크는 일부러 제외한다.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'data', 'inspections.json');
// GitHub Pages는 최상위 또는 docs 폴더만 게시할 수 있어서 폴더 이름이 docs 이다.
const OUT_DIR = path.join(__dirname, 'docs');
const OUT_FILE = path.join(OUT_DIR, 'data.json');

const records = JSON.parse(fs.readFileSync(SRC, 'utf-8'));

// 예전 형식(품목 1개가 레코드에 직접 붙어 있던 구조)도 품목 배열로 맞춘다.
function itemsOf(r) {
  if (Array.isArray(r.items) && r.items.length) return r.items;
  return [{ itemName: r.itemName, color: r.color, quantity: r.quantity, result: r.result }];
}

const safe = records.map(r => ({
  inspectionNo: r.inspectionNo,
  inspectionDate: r.inspectionDate,
  vendor: r.vendor,
  inspector: r.inspector,
  result: r.result,
  items: itemsOf(r).map(it => ({
    itemName: it.itemName || '',
    color: it.color || '',
    quantity: it.quantity != null ? it.quantity : null,
    result: it.result || '적합'
  }))
}));

const payload = {
  exportedAt: new Date().toISOString(),
  records: safe
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), 'utf-8');

const itemCount = safe.reduce((sum, r) => sum + r.items.length, 0);
console.log(`내보내기 완료: 성적서 ${safe.length}건 / 품목 ${itemCount}개 -> ${OUT_FILE}`);
console.log('제외된 항목: 사진, 불량내용, Lot No., 비고, 검사의뢰서/ERP 링크');
