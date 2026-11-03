const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const pd = require('../prescription-doc');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'db.json'), 'utf8'));
const v = {
  ...db.violations[0],
  number: 'GAL/2026/00114',
  media: [],
  createdAt: '2026-06-15T10:00:00.000Z',
  createdByName: 'Е.О. Чудинова',
  normRefs: ['ПОТ'],
};

// get xml right before strip
const zip = new PizZip(fs.readFileSync(pd.TEMPLATE_PATH, 'binary'));
let xml = zip.file('word/document.xml').asText();
const specialist = pd.formatSpecialist('Е.О. Чудинова');
const actDate = '15.06.2026';

// minimal pipeline to pre-strip state
const buildReplacements = (ctx, spec) => {
  const prescriptionNum = '114';
  const violation = v;
  const object = db.objects[1];
  const contractor = db.contractors[0];
  const actDateWords = '15 июня 2026';
  const ISSUER_ORG_SHORT = 'ООО «Виктория Строй»';
  const SIG_SHELF = '______________________________________________';
  const normsPrescriptionLine = () => 'ПОТ';
  const normsLine = () => 'Нарушение ПОТ';
  const objectLine = (o) => o.name;
  const recipientLine = () => 'x';
  const formatDeadlineRu = () => 'x';
  return [['[фото]', '']];
};

xml = xml.split('[фото]').join('');

const i = xml.lastIndexOf('промышленной и пожарной безопасности');
console.log('context around appendix end:', xml.slice(i, i + 600).replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, '[$1]').replace(/<[^>]+>/g, '|').slice(0, 400));

function stripDebug(xml) {
  const endTag = '</w:body>';
  const end = xml.lastIndexOf(endTag);
  let content = xml.slice(0, end);
  let sectPr = '';
  const sectIdx = content.lastIndexOf('<w:sectPr');
  const sectEnd = content.indexOf('</w:sectPr>', sectIdx);
  sectPr = content.slice(sectIdx, sectEnd + '</w:sectPr>'.length);
  content = content.slice(0, sectIdx) + content.slice(sectEnd + '</w:sectPr>'.length);
  let n = 0;
  while (n < 50) {
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
    if (hasText || hasDrawing || hasPageBreak) {
      console.log('stop n=', n, 'text:', [...para.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('|').slice(-80));
      console.log('para ends with close:', para.trimEnd().endsWith('</w:p>'));
      break;
    }
    content = trimmed.slice(0, pStart);
    n++;
  }
  const out = content + sectPr + endTag;
  console.log('removed', n, 'balance', (out.match(/<w:p[\s>]/g) || []).length, (out.match(/<\/w:p>/g) || []).length);
  console.log('tail:', out.slice(-300).replace(/\s+/g, ' '));
}

stripDebug(xml);
