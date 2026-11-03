#!/usr/bin/env node
/**
 * Сборка APK и публикация для скачивания с сайта.
 * Запуск: node victory-check-api/scripts/publish-apk.js
 *   --no-bump   не увеличивать versionCode / версию
 *   --skip-build только синхронизация www (без gradle)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const MOBILE = path.join(ROOT, 'victory-check-mobile');
const APK_ROOT = path.join(ROOT, 'victory-check-apk');
const ANDROID = path.join(APK_ROOT, 'android');
const VERSION_JSON = path.join(MOBILE, 'apk-version.json');
const OUT_APK = path.join(MOBILE, 'VisuralAudit.apk');
const GRADLE_APK = path.join(ANDROID, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const BUILD_GRADLE = path.join(ANDROID, 'app', 'build.gradle');
const VERSION_JS = path.join(MOBILE, 'js', 'version.js');
const ASSETS_WWW = path.join(ANDROID, 'app', 'src', 'main', 'assets', 'www');

/** Не класть в assets/www — иначе APK внутри APK (рост 3→100 MB за одну сборку). */
const SKIP_COPY_NAMES = new Set([
  'VisuralAudit.apk',
  'VisuralCheck.apk',
  'VictoryCheck.apk',
  '.apk-publish-state.json',
]);
const SKIP_COPY_DIRS = new Set(['node_modules', '.git']);

const args = new Set(process.argv.slice(2));
const bump = !args.has('--no-bump');
const skipBuild = args.has('--skip-build');

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return { ...fallback };
  }
}

function bumpSemver(name) {
  const parts = String(name || '1.0.0')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  parts[2] += 1;
  return parts.join('.');
}

function shouldSkipCopy(name, isDir) {
  if (name.startsWith('.')) return true;
  if (isDir && SKIP_COPY_DIRS.has(name)) return true;
  if (!isDir) {
    if (SKIP_COPY_NAMES.has(name)) return true;
    if (/\.apk$/i.test(name)) return true;
  }
  return false;
}

function copyRecursive(src, dst) {
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (shouldSkipCopy(ent.name, ent.isDirectory())) continue;
    const from = path.join(src, ent.name);
    const to = path.join(dst, ent.name);
    if (ent.isDirectory()) copyRecursive(from, to);
    else fs.copyFileSync(from, to);
  }
}

function appDisplayName(version) {
  return `Visural Audit v${version}`;
}

function syncAppLabels(version, versionCode) {
  const label = appDisplayName(version);
  const stringsPath = path.join(APK_ROOT, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
  fs.writeFileSync(
    stringsPath,
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="app_name">${label}</string>\n</resources>\n`
  );

  const manifestPath = path.join(MOBILE, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = readJson(manifestPath, {});
    manifest.name = label;
    manifest.short_name = `VA ${version}`;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  const indexPath = path.join(MOBILE, 'index.html');
  if (fs.existsSync(indexPath)) {
    let html = fs.readFileSync(indexPath, 'utf8');
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${label}</title>`);
    html = html.replace(
      /<meta name="apple-mobile-web-app-title" content="[^"]*">/,
      `<meta name="apple-mobile-web-app-title" content="${label}">`
    );
    fs.writeFileSync(indexPath, html);
  }
}

function syncVersionJs(version, versionCode) {
  const label = appDisplayName(version);
  let src = fs.readFileSync(VERSION_JS, 'utf8');
  src = src.replace(/const VC_LABEL_VERSION = '[^']*'/, `const VC_LABEL_VERSION = '${version}'`);
  src = src.replace(/const VC_VERSION = '[^']*'/, `const VC_VERSION = '${version}'`);
  src = src.replace(/const VC_BUILD = \d+/, `const VC_BUILD = ${versionCode}`);
  src = src.replace(/const VC_APP_NAME = '[^']*'/, `const VC_APP_NAME = '${label}'`);
  if (!/const VC_APP_NAME =/.test(src)) {
    src = src.replace(
      /const VC_BUILD = \d+;/,
      `const VC_BUILD = ${versionCode};\nconst VC_APP_NAME = '${label}';`
    );
  }
  fs.writeFileSync(VERSION_JS, src);
}

function updateBuildGradle(version, versionCode) {
  let gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');
  gradle = gradle.replace(/versionCode \d+/, `versionCode ${versionCode}`);
  gradle = gradle.replace(/versionName "[^"]*"/, `versionName "${version}"`);
  fs.writeFileSync(BUILD_GRADLE, gradle);
}

function syncMainActivityVersion(version) {
  const javaPath = path.join(APK_ROOT, 'android', 'app', 'src', 'main', 'java', 'ru', 'victorycheck', 'app', 'MainActivity.java');
  if (!fs.existsSync(javaPath)) return;
  let java = fs.readFileSync(javaPath, 'utf8');
  java = java.replace(/APP_VERSION = "[^"]*"/, `APP_VERSION = "${version}"`);
  java = java.replace(/VictoryCheck\.apk/, 'VisuralAudit.apk');
  fs.writeFileSync(javaPath, java);
}

function writeVersionInfo(info) {
  const body = `${JSON.stringify(info, null, 2)}\n`;
  fs.writeFileSync(VERSION_JSON, body);
  fs.writeFileSync(path.join(ASSETS_WWW, 'apk-version.json'), body);
}

if (!fs.existsSync(path.join(MOBILE, 'index.html'))) {
  console.error('Не найдена папка victory-check-mobile');
  process.exit(1);
}

const info = readJson(VERSION_JSON, {
  version: '1.2.4',
  versionCode: 13,
  file: 'VisuralAudit.apk',
  label: 'Visural Audit',
});

if (bump) {
  info.versionCode = (Number(info.versionCode) || 0) + 1;
  info.version = bumpSemver(info.version);
}
info.file = 'VisuralAudit.apk';
info.label = appDisplayName(info.version);
info.publishedAt = new Date().toISOString();

console.log(`Версия APK: ${info.version} (code ${info.versionCode}) — ${info.label}`);

const generateIcons = path.join(MOBILE, 'scripts', 'generate-icons.js');
if (fs.existsSync(generateIcons)) {
  console.log('Генерация иконок PWA и Android mipmap...');
  try {
    execSync(`node "${generateIcons}"`, { cwd: MOBILE, stdio: 'inherit', shell: true });
  } catch (e) {
    console.warn('generate-icons.js не выполнен:', e.message || e);
  }
}

console.log('Синхронизация www → assets...');
syncAppLabels(info.version, info.versionCode);
syncMainActivityVersion(info.version);
copyRecursive(MOBILE, ASSETS_WWW);
for (const ent of fs.readdirSync(ASSETS_WWW, { withFileTypes: true })) {
  if (!ent.isFile()) continue;
  if (/\.apk$/i.test(ent.name)) {
    console.error(`Ошибка: в assets/www остался ${ent.name} — APK внутри APK раздувает размер.`);
    process.exit(1);
  }
}
updateBuildGradle(info.version, info.versionCode);
syncVersionJs(info.version, info.versionCode);
writeVersionInfo(info);

if (!skipBuild) {
  const gradlew = path.join(ANDROID, 'gradlew.bat');
  if (!fs.existsSync(gradlew)) {
    console.error('Не найден gradlew.bat. Установите Android Studio и откройте проект victory-check-apk/android');
    process.exit(1);
  }
  console.log('Сборка APK (gradle clean assembleDebug)...');
  try {
    if (fs.existsSync(GRADLE_APK)) fs.unlinkSync(GRADLE_APK);
    execSync('gradlew.bat clean assembleDebug', { cwd: ANDROID, stdio: 'inherit', shell: true });
  } catch (e) {
    console.error('Сборка не удалась. Откройте Android Studio → Build APK или проверьте JAVA_HOME.');
    process.exit(1);
  }
}

if (!fs.existsSync(GRADLE_APK)) {
  console.error('APK не найден:', GRADLE_APK);
  console.error('Соберите вручную в Android Studio или запустите без --skip-build');
  process.exit(1);
}

fs.copyFileSync(GRADLE_APK, OUT_APK);
const stat = fs.statSync(OUT_APK);
info.sizeBytes = stat.size;
info.publishedAt = new Date().toISOString();
writeVersionInfo(info);

console.log('');
console.log('Готово.');
console.log(`  Файл: ${OUT_APK}`);
console.log(`  Размер: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
console.log(`  Скачивание: /api/mobile/apk?v=${info.version}`);
console.log('');
