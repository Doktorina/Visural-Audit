const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const pd = require('../prescription-doc');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'db.json'), 'utf8'));
const v = { ...db.violations[0], number: 'T', media: [], createdAt: '2026-06-15T10:00:00.000Z', createdByName: 'Е.О. Чудинова' };
const raw = new PizZip(
  pd.generatePrescriptionDocx(v, db, { object: db.objects[0], contractor: db.contractors[0] }).buffer
).file('word/document.xml').asText();

function strip(xml) {
  const endTag = '</w:body>';
  const end = xml.lastIndexOf(endTag);
  let content = xml.slice(0, end);
  let sectPr = '';
  const sectIdx = content.lastIndexOf('<w:sectPr');
  if (sectIdx >= 0) {
    const sectEnd = content.indexOf('</w:sectPr>', sectIdx);
    sectPr = content.slice(sectIdx, sectEnd + '</w:sectPr>'.length);
    content = content.slice(0, sectIdx) + content.slice(sectEnd + '</w:sectPr>'.length);
  }
  let n = 0;
  while (true) {
    const match = content.match(/<w:p[^>]*>[\s\S]*?<\/w:p>\s*$/);
    if (!match) break;
    const para = match[0];
    const hasText = /<w:t[^>]*>[^<\s][^<]*<\/w:t>/.test(para);
    const hasDrawing = para.includes('<w:drawing>');
    const hasPageBreak = para.includes('w:br w:type="page"');
    if (hasText || hasDrawing || hasPageBreak) {
      console.log('STOP:', [...para.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('|').slice(0, 80), 'drawing', hasDrawing);
      break;
    }
    content = content.slice(0, content.length - match[0].length);
    n++;
  }
  console.log('removed', n);
  return content + sectPr + endTag;
}

const stripped = strip(raw);
const end = stripped.lastIndexOf('</w:body>');
const tail = stripped.slice(end - 3000, end);
const empty = [...tail.matchAll(/<w:p[^>]*>[\s\S]*?<\/w:p>/g)].filter((m) => {
  const t = [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((x) => x[1]).join('').trim();
  return !t && !m[0].includes('drawing');
});
console.log('empty in last 3000 chars after strip:', empty.length);
