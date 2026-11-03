const fs = require('fs');
const PizZip = require('pizzip');
const z = new PizZip(fs.readFileSync('c:/Users/operator/Desktop/WOK/victory-check-api/templates/akt-predpisanie.docx', 'binary'));
const xml = z.file('word/document.xml').asText();
const markers = ['Предписание выдал', 'Е.О. Чудинова', '05.05.2026', 'Акт проверки получил', 'промышленной и пожарной безопасности»'];
for (const m of markers) {
  let i = 0;
  let pos = 0;
  while ((pos = xml.indexOf(m, pos)) >= 0) {
    i++;
    console.log('\n---', m, '#', i, 'at', pos, '---');
    console.log(xml.slice(pos - 100, pos + 250).replace(/\s+/g, ' ').slice(0, 350));
    pos += m.length;
  }
}
