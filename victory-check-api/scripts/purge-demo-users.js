/**
 * Удалить демо/тестовых пользователей из БД.
 * node scripts/purge-demo-users.js
 */
const path = require('path');
const fs = require('fs');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .forEach((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return;
      const i = t.indexOf('=');
      if (i > 0) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    });
}

loadEnv();

const usersStore = require('../users-store');

const PURGE_EMAILS = [
  'admin@demo.ru',
  'auditor@demo.ru',
  'contractor@demo.ru',
  'nekogoneybival1488@gmail.com',
];

async function main() {
  await usersStore.init();
  let removed = 0;
  for (const email of PURGE_EMAILS) {
    const u = await usersStore.findByEmail(email);
    if (!u) continue;
    await usersStore.deleteUser(u.id);
    console.log('Удалён:', email, `(${u.firstName || ''} ${u.lastName || ''}`.trim() + ')');
    removed += 1;
  }
  console.log(removed ? `\nГотово: удалено ${removed}` : '\nДемо-пользователи не найдены');
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
