// 사내 서버의 검사 데이터에서 "공개해도 되는 요약"만 뽑아 docs/data.json 으로 내보낸다.
// 공개 페이지이므로 사진, 불량내용, Lot No., 비고, 검사의뢰서/ERP 링크는 일부러 제외한다.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'data', 'inspections.json');
// GitHub Pages는 저장소 최상위 또는 docs 폴더만 게시할 수 있어서 폴더 이름이 docs 이다.
const OUT_DIR = path.join(__dirname, 'docs');
const OUT_FILE = path.join(OUT_DIR, 'data.json');

// 예전 형식(품목 1개가 레코드에 직접 붙어 있던 구조)도 품목 배열로 맞춘다.
function itemsOf(record) {
  if (Array.isArray(record.items) && record.items.length) return record.items;
  return [{
    itemName: record.itemName,
    color: record.color,
    quantity: record.quantity,
    result: record.result
  }];
}

function toPublicRecord(record) {
  return {
    inspectionNo: record.inspectionNo,
    inspectionDate: record.inspectionDate,
    vendor: record.vendor,
    inspector: record.inspector,
    result: record.result,
    items: itemsOf(record).map(item => ({
      itemName: item.itemName || '',
      color: item.color || '',
      quantity: item.quantity != null ? item.quantity : null,
      result: item.result || '적합'
    }))
  };
}

function readPrevious() {
  try {
    return JSON.parse(fs.readFileSync(OUT_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function main() {
  const records = JSON.parse(fs.readFileSync(SRC, 'utf-8'));
  const safe = records.map(toPublicRecord);

  // 검사 내용이 그대로면 파일을 다시 쓰지 않는다. (의미 없는 갱신 기록이 쌓이지 않도록)
  const previous = readPrevious();
  if (previous && JSON.stringify(previous.records) === JSON.stringify(safe)) {
    console.log('      변경된 검사 데이터가 없습니다. 공개용 파일을 그대로 둡니다.');
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify({
    exportedAt: new Date().toISOString(),
    records: safe
  }, null, 2), 'utf-8');

  const itemCount = safe.reduce((sum, r) => sum + r.items.length, 0);
  console.log(`      내보내기 완료: 성적서 ${safe.length}건 / 품목 ${itemCount}개`);
  console.log('      제외된 항목: 사진, 불량내용, Lot No., 비고, 검사의뢰서/ERP 링크');
}

main();
