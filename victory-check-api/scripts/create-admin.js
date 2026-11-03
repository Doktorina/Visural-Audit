#!/usr/bin/env node
/**
 * Создать администратора (Argon2id). Запуск из victory-check-api:
 *   node scripts/create-admin.js
 *   VC_ADMIN_EMAIL=x@y.ru VC_ADMIN_PASSWORD=secret node scripts/create-admin.js
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

async function main() {
  await usersStore.init();
  const email = process.env.VC_ADMIN_EMAIL || 'admin@victory-check.ru';
  const password = process.env.VC_ADMIN_PASSWORD || 'VictoryAdmin2026!';
  const result = await usersStore.ensureAdminUser({
    email,
    password,
    firstName: process.env.VC_ADMIN_FIRST_NAME || 'Victory',
    lastName: process.env.VC_ADMIN_LAST_NAME || 'Admin',
  });
  if (result.created) {
    console.log('Создан новый администратор:');
    console.log('  Email:   ', email);
    console.log('  Пароль:  ', password);
  } else {
    console.log('Администратор уже существует:', email);
    if (process.env.VC_ADMIN_PASSWORD) {
      console.log('Пароль обновлён (Argon2id).');
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
