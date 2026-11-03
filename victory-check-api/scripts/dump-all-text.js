const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const z = new PizZip(fs.readFileSync(path.join(__dirname, '..', 'templates', 'akt-predpisanie.docx'), 'binary'));
const x = z.file('word/document.xml').asText();
const all = [...x.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
const joined = all.join('|');
const keys = [
  'Специалист службы',
  'должность',
  'инициалы',
  'подпись',
  'дата',
  'Чудинова',
  'Чудиновой',
  'Акт проверки получил',
  'Предписание выдал',
  'Приложение',
];
for (const k of keys) {
  const idx = joined.indexOf(k);
  if (idx < 0) {
    console.log('NOT FOUND:', k);
    continue;
  }
  console.log('\n===', k, '===');
  console.log(joined.slice(Math.max(0, idx - 120), idx + 200));
}
