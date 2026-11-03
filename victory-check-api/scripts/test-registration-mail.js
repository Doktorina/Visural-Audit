/**
 * node scripts/test-registration-mail.js recipient@example.com
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .forEach((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return;
      const i = t.indexOf('=');
      if (i > 0) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    });
}

const to = process.argv[2] || 'kirillsadrin328@gmail.com';
const mailer = require('../mailer');

mailer
  .sendRegistrationMail({ to, firstName: 'Test', code: '111222' })
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.sent ? 0 : 1);
  })
  .catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
