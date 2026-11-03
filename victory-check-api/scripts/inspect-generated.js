const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const pd = require('../prescription-doc');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'db.json'), 'utf8'));
const v = {
  ...(db.violations[0] || {}),
  number: 'TEST/SIG',
  description: 'Тест',
  createdAt: '2026-06-15T10:00:00.000Z',
  createdByName: 'Елена Олеговна Чудинова',
  media: [],
  normRefs: ['ПОТ'],
};
const r = pd.generatePrescriptionDocx(v, db, { object: db.objects[0], contractor: db.contractors[0] });
const xml = new PizZip(r.buffer).file('word/document.xml').asText();

function dump(marker, n = 1) {
  let pos = 0;
  let i = 0;
  while ((pos = xml.indexOf(marker, pos)) >= 0) {
    i++;
    if (i <= n) {
      console.log('\n===', marker, '#', i, '===');
      const plain = xml
        .slice(pos - 200, pos + 800)
        .replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, (_, t) => t)
        .replace(/<[^>]+>/g, '|')
        .replace(/\|+/g, '|');
      console.log(plain.slice(0, 500));
    }
    pos += marker.length;
  }
}

[
  'Приложение №1',
  'промышленной и пожарной безопасности',
  'Е.О. Чудинова',
  'Е.О. Чудиновой',
  'Предписание выдал',
  'Акт проверки получил',
  'инициалы, фамилия',
  'Victory Admin',
  '______________________________________________',
].forEach((m) => {
  const c = (xml.match(new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  console.log(m, ':', c);
});

dump('Приложение №1');
dump('Предписание выдал', 2);
