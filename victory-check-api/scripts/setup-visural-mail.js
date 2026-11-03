/**
 * Настроить корпоративный SMTP mail.visural.ru в .env
 * MAILBOX=you@visural.ru SMTP_PASS=secret node scripts/setup-visural-mail.js
 */
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');
const EXAMPLE = path.join(__dirname, '..', '.env.example');

function upsertEnv(lines, key, value) {
  const re = new RegExp(`^${key}=`);
  let found = false;
  const next = lines.map((line) => {
    if (re.test(line)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) next.push(`${key}=${value}`);
  return next;
}

function main() {
  const mailbox = (process.env.MAILBOX || process.argv[2] || '').trim().toLowerCase();
  const pass = process.env.SMTP_PASS || process.argv[3] || '';
  if (!mailbox.includes('@') || !mailbox.includes('.')) {
    console.error('');
    console.error('ERROR: enter your MAILBOX, not the server name.');
    console.error('Wrong:  mail.visural.ru');
    console.error('Right:   sec-work@visural.ru');
    console.error('');
    console.error('Windows: run podklyuchit-pochtu-visural.bat');
    console.error('Linux:   MAILBOX=you@visural.ru SMTP_PASS=... node scripts/setup-visural-mail.js');
    console.error('');
    process.exit(1);
  }
  if (mailbox === 'mail.visural.ru') {
    console.error('');
    console.error('ERROR: mail.visural.ru is the SERVER, not your email.');
    console.error('Use your mailbox, for example: sec-work@visural.ru');
    console.error('');
    process.exit(1);
  }
  if (!pass) {
    console.error('ERROR: password is empty');
    process.exit(1);
  }
  if (!fs.existsSync(ENV_PATH) && fs.existsSync(EXAMPLE)) {
    fs.copyFileSync(EXAMPLE, ENV_PATH);
  }
  if (!fs.existsSync(ENV_PATH)) {
    console.error('Нет файла .env');
    process.exit(1);
  }
  const from = `Visural Audit <${mailbox}>`;
  let lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
  const kv = {
    DEFAULT_NOTIFY_EMAIL: mailbox,
    EMAIL_FROM: from,
    VC_ISSUER_EMAIL: mailbox,
    VC_USE_NORMAL_RECIPIENTS: 'true',
    SMTP_HOST: 'mail.visural.ru',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_USER: mailbox,
    SMTP_PASS: pass,
    SMTP_ENVELOPE_FROM: mailbox,
  };
  Object.entries(kv).forEach(([k, v]) => {
    lines = upsertEnv(lines, k, v);
  });
  fs.writeFileSync(ENV_PATH, `${lines.join('\n').replace(/\n*$/, '')}\n`, 'utf8');
  console.log('Готово: SMTP mail.visural.ru →', mailbox);
  console.log('Файл:', ENV_PATH);
  console.log('Проверка: node scripts/test-smtp.js', mailbox);
}

main();
