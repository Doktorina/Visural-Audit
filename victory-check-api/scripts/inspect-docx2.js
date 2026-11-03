const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const tpl = path.join(__dirname, '..', 'templates', 'akt-predpisanie.docx');
const zip = new PizZip(fs.readFileSync(tpl, 'binary'));
const xml = zip.file('word/document.xml').asText();

function ctx(pos, len = 400) {
  return xml.slice(Math.max(0, pos - 80), pos + len);
}

['rId7', 'rId8', 'ПРЕДПИСАНИЕ', 'Приложение №1'].forEach((s) => {
  const i = xml.indexOf(s);
  console.log('\n===', s, 'at', i, '===');
  if (i >= 0) console.log(ctx(i));
});
