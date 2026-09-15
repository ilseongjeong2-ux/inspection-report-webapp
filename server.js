const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'inspections.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const SCHEDULED_FILE = path.join(DATA_DIR, 'scheduled.json');
const DOC_NO_FLOOR_BY_YEAR = { '2026': 33 };
const RESULT_VALUES = ['적합', '부적합', '조건부적합'];
const MAX_PHOTO_BYTES = 100 * 1024 * 1024; // 사진 한 장 최대 용량

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]', 'utf-8');
if (!fs.existsSync(SCHEDULED_FILE)) fs.writeFileSync(SCHEDULED_FILE, '[]', 'utf-8');

// ---- 품목(items) 관련 헬퍼 ----
// 성적서 1장에 품목이 여러 개 들어갈 수 있다. 품목마다 판정/불량내용/사진을 따로 가진다.
// 예전에 저장된 데이터(품목 1개짜리 평면 구조)도 그대로 읽히도록 읽을 때 items 배열로 변환한다.

function safeJsonArray(text) {
  try {
    const parsed = JSON.parse(text || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeResult(value) {
  return RESULT_VALUES.includes(value) ? value : '적합';
}

// 품목별 판정을 모아 성적서 전체 판정을 정한다: 하나라도 부적합이면 부적합.
function overallResult(items) {
  if (!items.length) return '적합';
  if (items.some(it => it.result === '부적합')) return '부적합';
  if (items.some(it => it.result === '조건부적합')) return '조건부적합';
  return '적합';
}

// 기존 화면/CSV/필터가 쓰던 평면 필드(itemName, result, photoUrls 등)를 items로부터 다시 만들어 준다.
function withDerivedFields(record) {
  const items = record.items || [];
  const first = items[0] || {};
  const defectDetail = items
    .filter(it => it.defectDetail)
    .map(it => (items.length > 1 ? `[${it.itemName}] ${it.defectDetail}` : it.defectDetail))
    .join('\n');
  return {
    ...record,
    items,
    itemName: first.itemName || '',
    color: first.color || '',
    lotNo: first.lotNo || '',
    quantity: first.quantity != null ? first.quantity : null,
    result: overallResult(items),
    defectDetail,
    photoUrls: items.flatMap(it => it.photoUrls || []),
    defectPhotoUrls: items.flatMap(it => it.defectPhotoUrls || [])
  };
}

// 예전 형식(품목 1개가 레코드에 직접 붙어 있던 구조)을 items 배열 형식으로 올려준다.
function normalizeRecord(record) {
  if (Array.isArray(record.items) && record.items.length) return withDerivedFields(record);
  const legacyItem = {
    itemName: record.itemName || '',
    color: record.color || '',
    lotNo: record.lotNo || '',
    quantity: record.quantity != null ? record.quantity : null,
    result: normalizeResult(record.result),
    defectDetail: record.defectDetail || '',
    remarks: '',
    photoUrls: record.photoUrls || [],
    defectPhotoUrls: record.defectPhotoUrls || []
  };
  return withDerivedFields({ ...record, items: [legacyItem] });
}

function readRecords() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')).map(normalizeRecord);
}
function writeRecords(records) {
  fs.writeFileSync(DB_FILE, JSON.stringify(records, null, 2), 'utf-8');
}
function readScheduled() {
  return JSON.parse(fs.readFileSync(SCHEDULED_FILE, 'utf-8'));
}
function writeScheduled(items) {
  fs.writeFileSync(SCHEDULED_FILE, JSON.stringify(items, null, 2), 'utf-8');
}
function normalize(s) {
  return (s || '').trim().toLowerCase();
}
function generateDocNo(inspectionDate) {
  const [year, month] = inspectionDate.split('-');
  const yy = year.slice(2);
  const prefix = `퍼시스-시험${yy}-`;
  const used = new Set(
    readRecords()
      .filter(r => r.inspectionNo && r.inspectionNo.startsWith(prefix))
      .map(r => parseInt(r.inspectionNo.slice(-5), 10))
      .filter(n => Number.isFinite(n))
  );
  const floor = DOC_NO_FLOOR_BY_YEAR[year] || 1;
  // 빈 번호를 다시 채우지 않고, 그 해 마지막 번호의 다음 번호를 사용한다.
  const last = used.size ? Math.max(...used) : floor - 1;
  const seq = Math.max(last + 1, floor);
  return `${prefix}${month}-${String(seq).padStart(5, '0')}`;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOAD_DIR, req.recordId);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '_' + file.originalname);
    }
  }),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 300 }
});
// 사진 input 이름이 품목 순서에 따라 photos_0 / defectPhotos_0 ... 으로 늘어나므로 any()로 받는다.
const uploadAny = upload.any();

function groupUploadedFiles(req) {
  const grouped = {};
  (req.files || []).forEach(file => {
    const url = `/uploads/${req.recordId}/${file.filename}`;
    if (!grouped[file.fieldname]) grouped[file.fieldname] = [];
    grouped[file.fieldname].push(url);
  });
  return grouped;
}

// 폼(body)과 업로드된 파일로부터 품목 배열을 만든다.
// items 필드가 없으면(예: 옛 형식 CSV 불러오기) 예전처럼 평면 필드를 품목 1개로 취급한다.
function buildItems(body, filesByField) {
  let rows = safeJsonArray(body.items);
  const legacy = rows.length === 0;
  if (legacy) {
    rows = [{
      itemName: body.itemName,
      color: body.color,
      lotNo: body.lotNo,
      quantity: body.quantity,
      result: body.result,
      defectDetail: body.defectDetail,
      keepPhotos: safeJsonArray(body.keepPhotos),
      keepDefectPhotos: safeJsonArray(body.keepDefectPhotos)
    }];
  }
  return rows.map((row, index) => {
    const uploaded = filesByField[`photos_${index}`] || (legacy && index === 0 ? filesByField.photos || [] : []);
    const uploadedDefect = filesByField[`defectPhotos_${index}`] || (legacy && index === 0 ? filesByField.defectPhotos || [] : []);
    const keptPhotos = Array.isArray(row.keepPhotos) ? row.keepPhotos : [];
    const keptDefectPhotos = Array.isArray(row.keepDefectPhotos) ? row.keepDefectPhotos : [];
    const quantity = row.quantity === '' || row.quantity == null ? null : Number(row.quantity);
    return {
      itemName: (row.itemName || '').trim(),
      color: (row.color || '').trim(),
      lotNo: (row.lotNo || '').trim(),
      quantity: Number.isFinite(quantity) ? quantity : null,
      result: normalizeResult(row.result),
      defectDetail: (row.defectDetail || '').trim(),
      remarks: (row.remarks || '').trim(),
      photoUrls: [...keptPhotos, ...uploaded],
      defectPhotoUrls: [...keptDefectPhotos, ...uploadedDefect]
    };
  }).filter(item => item.itemName);
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

app.get('/api/scheduled', (req, res) => {
  const items = readScheduled().sort((a, b) => {
    const da = a.scheduledDate || '9999-99-99';
    const db = b.scheduledDate || '9999-99-99';
    return da < db ? -1 : da > db ? 1 : 0;
  });
  res.json(items);
});

app.post('/api/scheduled', (req, res) => {
  const b = req.body || {};
  if (!b.scheduledDate || !b.vendor || !b.itemName) {
    return res.status(400).json({ error: '입고예정일/업체명/품목명은 필수입니다.' });
  }
  const item = {
    id: crypto.randomUUID(),
    scheduledDate: b.scheduledDate,
    vendor: b.vendor,
    itemName: b.itemName,
    color: b.color || '',
    requestDocUrl: b.requestDocUrl || '',
    createdAt: new Date().toISOString()
  };
  const items = readScheduled();
  items.push(item);
  writeScheduled(items);
  res.status(201).json(item);
});

app.put('/api/scheduled/:id', (req, res) => {
  const b = req.body || {};
  if (!b.scheduledDate || !b.vendor || !b.itemName) {
    return res.status(400).json({ error: '입고예정일/업체명/품목명은 필수입니다.' });
  }
  const items = readScheduled();
  const idx = items.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '해당 항목을 찾을 수 없습니다.' });
  items[idx] = {
    ...items[idx],
    scheduledDate: b.scheduledDate,
    vendor: b.vendor,
    itemName: b.itemName,
    color: b.color || '',
    requestDocUrl: b.requestDocUrl || ''
  };
  writeScheduled(items);
  res.json(items[idx]);
});

app.delete('/api/scheduled/:id', (req, res) => {
  const items = readScheduled();
  const idx = items.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '해당 항목을 찾을 수 없습니다.' });
  items.splice(idx, 1);
  writeScheduled(items);
  res.json({ success: true });
});

app.get('/api/inspections', (req, res) => {
  const records = readRecords().sort((a, b) => {
    if (a.inspectionDate !== b.inspectionDate) return a.inspectionDate < b.inspectionDate ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
  res.json(records);
});

app.get('/api/inspections/:id', (req, res) => {
  const record = readRecords().find(r => r.id === req.params.id);
  if (!record) return res.status(404).json({ error: '해당 문서를 찾을 수 없습니다.' });
  res.json(record);
});

app.post('/api/inspections', (req, res, next) => {
  req.recordId = crypto.randomUUID();
  next();
}, uploadAny, (req, res) => {
  try {
    const b = req.body;
    const items = buildItems(b, groupUploadedFiles(req));
    if (!b.inspectionDate || !b.vendor || !items.length) {
      return res.status(400).json({ error: '검사일자/업체명/품목명은 필수입니다.' });
    }
    const record = withDerivedFields({
      id: req.recordId,
      inspectionNo: generateDocNo(b.inspectionDate),
      inspectionDate: b.inspectionDate,
      vendor: b.vendor,
      items,
      inspector: b.inspector || '',
      inspectionItem: b.inspectionItem || '',
      criteria: b.criteria || '',
      requestDocUrl: b.requestDocUrl || '',
      reportDocUrl: b.reportDocUrl || '',
      remarks: b.remarks || '',
      createdAt: new Date().toISOString()
    });
    const records = readRecords();
    records.push(record);
    writeRecords(records);

    // 등록된 품목과 일치하는 입고예정 건은 목록에서 지운다.
    const scheduled = readScheduled();
    const remainingScheduled = scheduled.filter(s => {
      if (normalize(s.vendor) !== normalize(record.vendor)) return true;
      const matched = record.items.some(it => {
        const itemMatch = normalize(s.itemName) === normalize(it.itemName);
        const colorMatch = !s.color || normalize(s.color) === normalize(it.color);
        return itemMatch && colorMatch;
      });
      return !matched;
    });
    if (remainingScheduled.length !== scheduled.length) writeScheduled(remainingScheduled);

    res.status(201).json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/inspections/:id', (req, res, next) => {
  req.recordId = req.params.id;
  next();
}, uploadAny, (req, res) => {
  try {
    const records = readRecords();
    const idx = records.findIndex(r => r.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: '해당 문서를 찾을 수 없습니다.' });

    const b = req.body;
    const items = buildItems(b, groupUploadedFiles(req));
    if (!b.inspectionDate || !b.vendor || !items.length) {
      return res.status(400).json({ error: '검사일자/업체명/품목명은 필수입니다.' });
    }

    // 수정 후 남은 사진 목록에 없는 파일은 디스크에서도 지운다.
    const existing = records[idx];
    const keptUrls = new Set(items.flatMap(it => [...it.photoUrls, ...it.defectPhotoUrls]));
    const previousUrls = [...(existing.photoUrls || []), ...(existing.defectPhotoUrls || [])];
    previousUrls
      .filter(url => !keptUrls.has(url))
      .forEach(url => {
        fs.unlink(path.join(UPLOAD_DIR, url.replace(/^\/uploads\//, '')), () => {});
      });

    const updated = withDerivedFields({
      ...existing,
      inspectionDate: b.inspectionDate,
      vendor: b.vendor,
      items,
      inspector: b.inspector || '',
      inspectionItem: b.inspectionItem || '',
      criteria: b.criteria || '',
      requestDocUrl: b.requestDocUrl || '',
      reportDocUrl: b.reportDocUrl || '',
      remarks: b.remarks || '',
      updatedAt: new Date().toISOString()
    });
    records[idx] = updated;
    writeRecords(records);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/inspections/:id', (req, res) => {
  const records = readRecords();
  const idx = records.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '해당 문서를 찾을 수 없습니다.' });
  records.splice(idx, 1);
  writeRecords(records);
  fs.rm(path.join(UPLOAD_DIR, req.params.id), { recursive: true, force: true }, () => {});
  res.json({ success: true });
});

// 사내망 IP는 바뀔 수 있으므로 켤 때마다 지금 주소를 보여 준다.
function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(net => net && net.family === 'IPv4' && !net.internal)
    .map(net => net.address);
}

const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE: `사진 한 장의 용량이 너무 큽니다. (한 장당 ${Math.round(MAX_PHOTO_BYTES / 1024 / 1024)}MB까지)`,
  LIMIT_FILE_COUNT: '사진 개수가 너무 많습니다.',
  LIMIT_UNEXPECTED_FILE: '예상하지 못한 사진 항목이 있습니다.',
  LIMIT_PART_COUNT: '한 번에 보낼 수 있는 양을 넘었습니다. 품목이나 사진을 나눠서 저장해 주세요.'
};

function logError(message) {
  console.error(message);
  try {
    fs.appendFileSync(path.join(__dirname, 'server_log.txt'),
      `[${new Date().toISOString()}] ${message}\n`, 'utf-8');
  } catch { /* 기록 실패는 무시한다 */ }
}

// 라우트에서 처리되지 못한 오류를 여기서 붙잡아 사람이 읽을 수 있는 메시지로 돌려준다.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && err.name === 'MulterError') {
    logError(`[사진 업로드 오류] ${err.code} (${err.field || '-'}) ${req.method} ${req.originalUrl}`);
    return res.status(400).json({ error: MULTER_MESSAGES[err.code] || ('사진 업로드 오류: ' + err.code) });
  }
  logError(`[서버 오류] ${req.method} ${req.originalUrl}\n${err && err.stack ? err.stack : err}`);
  res.status(500).json({ error: (err && err.message) || '알 수 없는 서버 오류' });
});

app.listen(PORT, () => {
  console.log('');
  console.log('============================================');
  console.log('  검사성적서 서버가 실행 중입니다');
  console.log('============================================');
  console.log('');
  console.log('  이 PC에서    :  http://localhost:' + PORT);
  lanAddresses().forEach(address => {
    console.log('  사내 다른 PC :  http://' + address + ':' + PORT);
  });
  console.log('');
  console.log('  종료하려면 이 창을 닫으세요.');
  console.log('  창을 닫으면 동료들도 접속할 수 없습니다.');
  console.log('');
});
