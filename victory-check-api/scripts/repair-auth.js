/**
 * Восстановление входа: сброс пароля администратора и проверка БД пользователей.
 * node scripts/repair-auth.js
 */
const path = require('path');
const fs = require('fs');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .forEach((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return;
      const i = t.indexOf('=');
      if (i > 0) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    });
}

loadEnv();

const usersStore = require('../users-store');
const security = require('../security');

async function main() {
  process.env.VC_FORCE_ADMIN_PASSWORD = 'true';
  await usersStore.init();
  const users = await usersStore.listUsers();
  console.log('Пользователей:', users.length);
  users.forEach((u) => console.log(' -', u.email, u.role, u.status || 'active'));

  const email = process.env.VC_ADMIN_EMAIL || 'admin@victory-check.ru';
  const password = process.env.VC_ADMIN_PASSWORD || 'VictoryAdmin2026!';
  const result = await usersStore.ensureAdminUser({
    email,
    password,
    firstName: 'Victory',
    lastName: 'Admin',
  });

  const found = await usersStore.findByEmail(email);
  const check = await security.verifyPassword(found, password);
  const login = await usersStore.login(email, password);

  console.log('');
  console.log('=== Администратор ===');
  console.log('Email:   ', email);
  console.log('Пароль:  ', password);
  console.log('Создан:  ', result.created ? 'да' : 'нет (обновлён)');
  console.log('verify:  ', check.ok);
  console.log('login:   ', login ? 'OK' : 'FAIL');
  if (!login) process.exit(1);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
