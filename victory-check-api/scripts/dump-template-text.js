const fs = require('fs');
const PizZip = require('pizzip');
const z = new PizZip(fs.readFileSync(require('path').join(__dirname, '..', 'templates', 'akt-predpisanie.docx'), 'binary'));
const x = z.file('word/document.xml').asText();

function texts(from, to) {
  const seg = x.slice(from, to);
  return [...seg.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
}

const pos = x.indexOf('Е.О. Чудинова');
console.log('around first Chudinova:', texts(pos - 3000, pos + 500).join(' | '));
const pos2 = x.lastIndexOf('Е.О. Чудинова');
console.log('\naround last:', texts(pos2 - 500, pos2 + 1500).join(' | '));

const pos3 = x.indexOf('Акт проверки получил');
console.log('\naround akt received:', texts(pos3 - 200, pos3 + 2000).join(' | '));
