/**
 * Проверка SMTP из .env
 * node scripts/test-smtp.js [email-получателя]
 */
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error('Нет файла .env — сначала запустите podklyuchit-pochtu-visural.bat');
    process.exit(1);
  }
  fs.readFileSync(ENV_PATH, 'utf8')
    .split(/\r?\n/)
    .forEach((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return;
      const i = t.indexOf('=');
      if (i > 0) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    });
}

function explain(err) {
  const raw = String(err?.message || err || '').toLowerCase();
  if (raw.includes('535') || raw.includes('authentication') || raw.includes('login')) {
    return [
      'Ошибка входа SMTP.',
      'Проверьте пароль от https://mail.visural.ru/',
      'Если включена двухфакторная защита — создайте «пароль для внешнего приложения» в настройках почты.',
    ].join(' ');
  }
  if (raw.includes('econnrefused') || raw.includes('enotfound') || raw.includes('timeout')) {
    return 'Не удалось подключиться к mail.visural.ru:587 — проверьте интернет и VPN.';
  }
  return String(err?.message || err || 'Неизвестная ошибка');
}

async function main() {
  loadEnv();
  const to = (process.argv[2] || process.env.SMTP_USER || '').trim();
  if (!to.includes('@')) {
    console.error('Укажите email: node scripts/test-smtp.js you@visural.ru');
    process.exit(1);
  }
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.error('SMTP не настроен в .env — запустите podklyuchit-pochtu-visural.bat');
    process.exit(1);
  }

  console.log('Проверка SMTP:', process.env.SMTP_HOST, '→', process.env.SMTP_USER);
  const mailer = require('../mailer');
  const result = await mailer.sendMail({
    to,
    subject: 'Visural Audit — тест почты',
    text: `Тестовое письмо ${new Date().toLocaleString('ru-RU')}\n\nЕсли вы видите это — SMTP настроен.`,
  });
  if (result.sent) {
    console.log('OK:', result.message);
    process.exit(0);
  }
  console.error('FAIL:', result.message || 'письмо не отправлено');
  if (result.outboxFile) console.error('Сохранено в outbox:', result.outboxFile);
  process.exit(1);
}

main().catch((e) => {
  console.error('FAIL:', explain(e));
  process.exit(1);
});
