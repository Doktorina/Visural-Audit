const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const x = new PizZip(
  fs.readFileSync(path.join(__dirname, '..', 'templates', 'akt-predpisanie.docx'), 'binary')
).file('word/document.xml').asText();
for (const m of ['[фото]', 'фото', 'наименование нормативного']) {
  const i = x.indexOf(m);
  console.log(m, 'at', i);
  if (i >= 0) {
    const plain = x
      .slice(i - 400, i + 300)
      .replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, (_, t) => t)
      .replace(/<[^>]+>/g, '|');
    console.log(plain);
  }
}
