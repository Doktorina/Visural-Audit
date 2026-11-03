/**
 * Фото нарушений на диске сервера: data/uploads/{violationId}/
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_ROOT = path.join(__dirname, 'data', 'uploads');
const MAX_PHOTOS = 10;
const MAX_BYTES = 5 * 1024 * 1024;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeViolationId(id) {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

function violationDir(violationId) {
  return path.join(UPLOAD_ROOT, safeViolationId(violationId));
}

function publicUrl(violationId, filename) {
  return `/api/media/${safeViolationId(violationId)}/${filename}`;
}

function safeFilename(name) {
  return path.basename(String(name).replace(/[^a-zA-Z0-9._-]/g, ''));
}

function parseDataUrl(dataUrl) {
  const m = String(dataUrl).match(/^data:(image\/[\w+.-]+);base64,(.+)$/s);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  let ext = '.jpg';
  if (mime.includes('png')) ext = '.png';
  else if (mime.includes('webp')) ext = '.webp';
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_BYTES) throw new Error('Фото слишком большое (макс. 5 МБ)');
  return { buf, ext, mime };
}

async function persistViolationMedia(violationId, items) {
  if (!Array.isArray(items) || !items.length) return [];
  const dir = violationDir(violationId);
  ensureDir(dir);
  const out = [];
  for (const item of items.slice(0, MAX_PHOTOS)) {
    if (!item) continue;
    const s = String(item);
    if (s.startsWith('/api/media/')) {
      out.push(s);
      continue;
    }
    if (s.startsWith('data:image/')) {
      const parsed = parseDataUrl(s);
      if (!parsed) continue;
      const fname = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${parsed.ext}`;
      fs.writeFileSync(path.join(dir, fname), parsed.buf);
      out.push(publicUrl(violationId, fname));
      continue;
    }
    if (/^https?:\/\//i.test(s)) out.push(s);
  }
  return out;
}

function resolveFilePath(urlOrPath) {
  const s = String(urlOrPath || '');
  const m = s.match(/\/api\/media\/([^/]+)\/([^/?#]+)/);
  if (!m) return null;
  const fp = path.join(violationDir(m[1]), safeFilename(m[2]));
  const root = path.resolve(UPLOAD_ROOT);
  if (!path.resolve(fp).startsWith(root + path.sep)) return null;
  if (!fs.existsSync(fp)) return null;
  return fp;
}

function getViolationMediaPaths(media) {
  return (media || []).map(resolveFilePath).filter(Boolean);
}

function mimeForFile(fp) {
  const ext = path.extname(fp).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function serveMedia(res, violationId, filename) {
  const fp = resolveFilePath(publicUrl(violationId, filename));
  if (!fp) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': mimeForFile(fp),
    'Cache-Control': 'public, max-age=604800',
  });
  fs.createReadStream(fp).pipe(res);
}

function countObjectPhotos(db, objectId) {
  let n = 0;
  for (const v of db.violations || []) {
    if (v.objectId !== objectId) continue;
    n += (v.media || []).length;
  }
  return n;
}

function violationsForObject(db, objectId) {
  return (db.violations || [])
    .filter((v) => v.objectId === objectId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function collectObjectMedia(db, objectId, limit = 15) {
  const items = [];
  for (const v of violationsForObject(db, objectId)) {
    for (const m of v.media || []) {
      const fp = resolveFilePath(m);
      if (fp) {
        items.push({ violation: v, path: fp, caption: `№${v.number}` });
      } else if (String(m).startsWith('data:image/')) {
        const parsed = parseDataUrl(m);
        if (parsed) {
          items.push({
            violation: v,
            buffer: parsed.buf,
            filename: `photo${parsed.ext}`,
            caption: `№${v.number}`,
          });
        }
      }
      if (items.length >= limit) return items;
    }
  }
  return items;
}

function deleteViolationMedia(violationId) {
  const dir = violationDir(violationId);
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = {
  UPLOAD_ROOT,
  persistViolationMedia,
  resolveFilePath,
  getViolationMediaPaths,
  serveMedia,
  countObjectPhotos,
  violationsForObject,
  collectObjectMedia,
  publicUrl,
  deleteViolationMedia,
  mimeForFile,
};
