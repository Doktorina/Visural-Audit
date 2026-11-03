/**
 * Создать/обновить администратора и удалить демо-аккаунты.
 * node scripts/setup-admin.js
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

const DEMO_EMAILS = [
  'admin@demo.ru',
  'auditor@demo.ru',
  'contractor@demo.ru',
  'nekogoneybival1488@gmail.com',
];

async function main() {
  process.env.VC_FORCE_ADMIN_PASSWORD = 'true';
  await usersStore.init();
  const email = process.env.VC_ADMIN_EMAIL || 'admin@victory-check.ru';
  const password = process.env.VC_ADMIN_PASSWORD || 'VictoryAdmin2026!';
  const result = await usersStore.ensureAdminUser({
    email,
    password,
    firstName: 'Victory',
    lastName: 'Admin',
  });
  for (const demo of DEMO_EMAILS) {
    const u = await usersStore.findByEmail(demo);
    if (u) {
      await usersStore.deleteUser(u.id);
      console.log('Удалён демо:', demo);
    }
  }
  console.log('');
  console.log('=== Администратор ===');
  console.log('Email:  ', email);
  console.log('Пароль: ', password);
  console.log('Роль:   admin');
  console.log(result.created ? '(создан)' : '(обновлён)');
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
