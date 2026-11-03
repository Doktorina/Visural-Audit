function encodeSubject(subject) {
  return `=?UTF-8?B?${Buffer.from(String(subject || ''), 'utf8').toString('base64')}?=`;
}

function normalizeAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .filter((a) => a && (a.content != null || a.buffer != null))
    .map((a, i) => {
      const content = Buffer.isBuffer(a.content)
        ? a.content
        : Buffer.isBuffer(a.buffer)
          ? a.buffer
          : Buffer.from(a.content || a.buffer || '');
      return {
        filename: String(a.filename || `file_${i + 1}`).replace(/[\r\n"]/g, '_'),
        content,
        contentType: a.contentType || 'application/octet-stream',
      };
    })
    .filter((a) => a.content.length);
}

function encodeMimeWord(value) {
  const s = String(value || '');
  if (!/[^\x00-\x7F]/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

function encodeFrom(from) {
  const raw = String(from || '').trim();
  const m = raw.match(/^(.+?)\s*<([^>]+)>$/);
  if (!m) return raw;
  const name = m[1].trim().replace(/^["']|["']$/g, '');
  const addr = m[2].trim();
  if (!name || !/[^\x00-\x7F]/.test(name)) return raw;
  return `${encodeMimeWord(name)} <${addr}>`;
}

function buildPlainEml(from, to, subject, text) {
  return [
    `From: ${encodeFrom(from)}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
  ].join('\r\n');
}

function buildMimeMessage({ from, to, subject, text, attachments }) {
  const files = normalizeAttachments(attachments);
  const fromHdr = encodeFrom(from);
  if (!files.length) return buildPlainEml(from, to, subject, text);
  const boundary = `VictoryCheck_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const lines = [
    `From: ${fromHdr}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
  ];
  files.forEach((f) => {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${f.contentType}; name="${f.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${f.filename}"`,
      '',
      f.content.toString('base64'),
      ''
    );
  });
  lines.push(`--${boundary}--`, '');
  return lines.join('\r\n');
}

module.exports = {
  encodeSubject,
  normalizeAttachments,
  buildPlainEml,
  buildMimeMessage,
};
