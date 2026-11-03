const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'akt-predpisanie.docx');
const pd = require('../prescription-doc');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'db.json'), 'utf8'));

function countP(xml) {
  return { open: (xml.match(/<w:p[\s>]/g) || []).length, close: (xml.match(/<\/w:p>/g) || []).length };
}

const v = {
  ...db.violations[0],
  number: 'GAL/2026/00114',
  media: [],
  createdAt: '2026-06-15T10:00:00.000Z',
  createdByName: 'Е.О. Чудинова',
  normRefs: ['ПОТ'],
};
const specialist = pd.formatSpecialist('Е.О. Чудинова');
const actDate = '15.06.2026';
const ctx = { object: db.objects[1], contractor: db.contractors[0], violation: v, prescriptionNum: '114' };

const zip = new PizZip(fs.readFileSync(TEMPLATE_PATH, 'binary'));
let xml = zip.file('word/document.xml').asText();
console.log('0 template', countP(xml));

// replacements - duplicate buildReplacements by calling generate pieces
const code = fs.readFileSync(path.join(__dirname, '..', 'prescription-doc.js'), 'utf8');
const buildReplacements = new Function(
  'ctx',
  'specialist',
  code.replace(/^[\s\S]*function buildReplacements/, 'function buildReplacements').match(/function buildReplacements[\s\S]*?^}/m)[0] +
    '; return buildReplacements(ctx, specialist);'
);
// too hacky - step through by reading exported internals

// use eval of individual functions from module file
function loadFn(name) {
  const m = code.match(new RegExp(`function ${name}\\([\\s\\S]*?^}`, 'm'));
  if (!m) throw new Error('no ' + name);
  return new Function(
    'xmlEscape',
    'SIG_SHELF',
    'SIG_SHELF_SHORT',
    'textPara',
    'shelfPara',
    'cellTwoLines',
    'replaceAll',
    'replaceTcContent',
    'rebuildLabelRow',
    'rebuildSignatureTable',
    'PAGE_BREAK_PARA',
    'PHOTO_PAIR_CX',
    'PHOTO_PAIR_CY',
    'PHOTO_GAP_AFTER',
    m[0] + `; return ${name};`
  )(
    (t) =>
      String(t || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;'),
    '______________________________________________',
    '________________________',
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>',
    3200400,
    2200000,
    480
  );
}

// simpler approach: binary search which step breaks
const r1 = pd.generatePrescriptionDocx(v, db, { object: db.objects[1], contractor: db.contractors[0] });

// Read functions from prescription-doc by requiring and testing strip only on good xml
const zip2 = new PizZip(fs.readFileSync(TEMPLATE_PATH, 'binary'));
let x = zip2.file('word/document.xml').asText();

// inline strip from file
function stripTrailingEmptyParagraphs(xml) {
  const endTag = '</w:body>';
  const end = xml.lastIndexOf(endTag);
  if (end < 0) return xml;
  let content = xml.slice(0, end);
  const after = xml.slice(end + endTag.length);
  let sectPr = '';
  const sectIdx = content.lastIndexOf('<w:sectPr');
  if (sectIdx >= 0) {
    const sectEnd = content.indexOf('</w:sectPr>', sectIdx);
    if (sectEnd >= 0) {
      sectPr = content.slice(sectIdx, sectEnd + '</w:sectPr>'.length);
      content = content.slice(0, sectIdx) + content.slice(sectEnd + '</w:sectPr>'.length);
    }
  }
  while (true) {
    const trimmed = content.replace(/\s+$/, '');
    const pEnd = trimmed.lastIndexOf('</w:p>');
    if (pEnd < 0) break;
    const pStart = trimmed.lastIndexOf('<w:p', pEnd);
    if (pStart < 0) break;
    const para = trimmed.slice(pStart, pEnd + '</w:p>'.length);
    const hasText = /<w:t[^>]*>[^<\s][^<]*<\/w:t>/.test(para);
    const hasDrawing = para.includes('<w:drawing>');
    const hasPageBreak =
      para.includes('w:br w:type="page"') || para.includes('w:pageBreakBefore w:val="1"');
    if (hasText || hasDrawing || hasPageBreak) break;
    content = trimmed.slice(0, pStart);
  }
  return content + sectPr + endTag + after;
}

console.log('strip template only', countP(stripTrailingEmptyParagraphs(x)));

const genXml = new PizZip(r1.buffer).file('word/document.xml').asText();
console.log('generated before strip would be...', countP(genXml));

// test strip on template - should stay balanced
const strippedTpl = stripTrailingEmptyParagraphs(x);
console.log('stripped template', countP(strippedTpl), strippedTpl.slice(-200));
