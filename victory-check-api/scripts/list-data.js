const fs = require('fs');
const p = 'data/db.json';
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
console.log('objects', (d.objects || []).length);
(d.objects || []).forEach((o) => console.log(o.id, o.code, o.name));
console.log('contractors', (d.contractors || []).length);
(d.contractors || []).forEach((c) => console.log(c.id, c.name));
console.log('violations', (d.violations || []).length);
console.log('users', (d.users || []).length);
