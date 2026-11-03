const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const pd = require('../prescription-doc');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'db.json'), 'utf8'));

function validate(xml, label) {
  const checks = {
    hasDocument: xml.includes('<w:document'),
    hasBodyOpen: xml.includes('<w:body>'),
    hasBodyClose: xml.includes('</w:body>'),
    hasDocumentClose: xml.includes('</w:document>'),
    bodyBeforeDocumentClose:
      xml.lastIndexOf('</w:body>') < xml.lastIndexOf('</w:document>'),
    sectPrInsideBody: (() => {
      const b0 = xml.indexOf('<w:body>');
      const b1 = xml.lastIndexOf('</w:body>');
      const s = xml.lastIndexOf('<w:sectPr');
      return s > b0 && s < b1;
    })(),
    tblOpen: (xml.match(/<w:tbl>/g) || []).length,
    tblClose: (xml.match(/<\/w:tbl>/g) || []).length,
    trOpen: (xml.match(/<w:tr>/g) || []).length,
    trClose: (xml.match(/<\/w:tr>/g) || []).length,
    tcOpen: (xml.match(/<w:tc>/g) || []).length,
    tcClose: (xml.match(/<\/w:tc>/g) || []).length,
    pOpen: (xml.match(/<w:p[\s>]/g) || []).length,
    pClose: (xml.match(/<\/w:p>/g) || []).length,
  };
  checks.balancedTbl = checks.tblOpen === checks.tblClose;
  checks.balancedTr = checks.trOpen === checks.trClose;
  checks.balancedTc = checks.tcOpen === checks.tcClose;
  checks.balancedP = checks.pOpen === checks.pClose;
  console.log('\n===', label, '===');
  console.log(checks);
  const tail = xml.slice(-500);
  console.log('tail:', tail.replace(/\s+/g, ' '));
  return checks;
}

const imgPath =
  'C:/Users/operator/.cursor/projects/c-Users-operator-Desktop-WOK/assets/c__Users_operator_AppData_Roaming_Cursor_User_workspaceStorage_d32f8f8d4e9e99ce0947bd3f4c9e0c25_images_image-0db9b3a3-9e2a-41ff-80f7-c4a625b5dc89.png';
const buf = fs.readFileSync(imgPath);
const b64 = 'data:image/png;base64,' + buf.toString('base64');

for (const [label, media] of [
  ['no photos', []],
  ['2 photos', [b64, b64]],
]) {
  const v = {
    ...db.violations[0],
    number: 'GAL/2026/00114',
    description: 'Тест',
    createdAt: '2026-06-15T10:00:00.000Z',
    createdByName: 'Е.О. Чудинова',
    media,
    normRefs: ['ПОТ'],
  };
  const r = pd.generatePrescriptionDocx(v, db, { object: db.objects[1], contractor: db.contractors[0] });
  const outPath = path.join(__dirname, '..', 'data', 'outbox', `validate_${label.replace(/\s/g, '_')}.docx`);
  fs.writeFileSync(outPath, r.buffer);
  const xml = new PizZip(r.buffer).file('word/document.xml').asText();
  validate(xml, label);
}

// template baseline
const tpl = new PizZip(fs.readFileSync(pd.TEMPLATE_PATH, 'binary')).file('word/document.xml').asText();
validate(tpl, 'template');
