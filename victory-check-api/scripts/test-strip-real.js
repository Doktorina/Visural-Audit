const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const pd = require('../prescription-doc');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'db.json'), 'utf8'));
const v = {
  ...db.violations[0],
  number: 'TEST/P',
  description: 'Тест',
  createdAt: '2026-06-15T10:00:00.000Z',
  createdByName: 'Е.О. Чудинова',
  media: [],
  normRefs: ['ПОТ'],
};

// generate without strip by temporarily patching
const orig = fs.readFileSync(path.join(__dirname, '..', 'prescription-doc.js'), 'utf8');
const zip = new PizZip(fs.readFileSync(pd.TEMPLATE_PATH, 'binary'));
let docXml = zip.file('word/document.xml').asText();
docXml = docXml.replace('[фото]', '');
const before = (docXml.match(/<w:p[^>]*>[\s\S]*?<\/w:p>/g) || []).length;

function strip(xml) {
  const endTag = '</w:body>';
  const end = xml.lastIndexOf(endTag);
  let content = xml.slice(0, end);
  let n = 0;
  while (true) {
    const match = content.match(/<w:p[^>]*>[\s\S]*?<\/w:p>\s*$/);
    if (!match) break;
    const para = match[0];
    const hasText = /<w:t[^>]*>[^<\s][^<]*<\/w:t>/.test(para);
    const hasDrawing = para.includes('<w:drawing>');
    const hasSectPr = para.includes('<w:sectPr');
    if (hasSectPr) {
      console.log('stop at sectPr para, len', para.length);
      break;
    }
    if (hasText || hasDrawing) {
      console.log('stop at content para:', [...para.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('').slice(0, 50));
      break;
    }
    content = content.slice(0, content.length - match[0].length);
    n++;
  }
  console.log('stripped', n);
  return content + endTag;
}

const r = pd.generatePrescriptionDocx(v, db, { object: db.objects[0], contractor: db.contractors[0] });
const xml = new PizZip(r.buffer).file('word/document.xml').asText();
const end = xml.lastIndexOf('</w:body>');
const tail = xml.slice(end - 5000, end);
console.log('has sectPr in tail', tail.includes('sectPr'));
strip(xml);
