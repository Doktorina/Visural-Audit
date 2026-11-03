const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const x = new PizZip(
  fs.readFileSync(path.join(__dirname, '..', 'templates', 'akt-predpisanie.docx'), 'binary')
).file('word/document.xml').asText();

function dumpBetween(startMarker, endMarker) {
  const s = x.indexOf(startMarker);
  const e = x.indexOf(endMarker, s + startMarker.length);
  const seg = x.slice(s, e + 200);
  const texts = [...seg.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
  console.log('\n===', startMarker, '===');
  console.log(texts.join(' | '));
}

dumpBetween('Предписание выдал', 'Акт проверки получил');
dumpBetween('Акт проверки получил', 'ПРЕДПИСАНИЕ');

// count tbl after Предписание выдал
const i = x.indexOf('Предписание выдал');
const seg = x.slice(i, i + 8000);
console.log('\ntables in sig block:', (seg.match(/<w:tbl>/g) || []).length);
console.log('rows:', (seg.match(/<w:tr>/g) || []).length);
