/**
 * Автосборка APK при изменении victory-check-mobile.
 * Отключить: VC_AUTO_APK_PUBLISH=false в .env
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MOBILE = path.join(ROOT, 'victory-check-mobile');
const PUBLISH_SCRIPT = path.join(__dirname, 'scripts', 'publish-apk.js');
const STATE_FILE = path.join(MOBILE, '.apk-publish-state.json');
const GRADLEW = path.join(ROOT, 'victory-check-apk', 'android', 'gradlew.bat');

const SKIP_FILES = new Set([
  'VisuralAudit.apk',
  'VisuralCheck.apk',
  'apk-version.json',
  '.apk-publish-state.json',
  'version.js',
  'manifest.json',
  'index.html',
]);

const SKIP_DIRS = new Set(['node_modules', '.git']);

let publishing = false;
let debounceTimer = null;

function autoEnabled() {
  return process.env.VC_AUTO_APK_PUBLISH !== 'false';
}

function canBuild() {
  return fs.existsSync(GRADLEW);
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(patch) {
  const next = { ...readState(), ...patch };
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(next, null, 2)}\n`);
}

function computeFingerprint() {
  const parts = [];
  let maxMtime = 0;

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue;
      if (SKIP_FILES.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        walk(full);
        continue;
      }
      if (!/\.(html?|js|css|json|svg|webmanifest)$/i.test(ent.name)) continue;
      const st = fs.statSync(full);
      maxMtime = Math.max(maxMtime, st.mtimeMs);
      parts.push(`${path.relative(MOBILE, full)}:${st.mtimeMs}:${st.size}`);
    }
  }

  walk(MOBILE);
  const fingerprint = crypto.createHash('sha1').update(parts.sort().join('|')).digest('hex');
  return { fingerprint, maxMtime };
}

function needsPublish() {
  const apkPath = path.join(MOBILE, 'VisuralAudit.apk');
  if (!fs.existsSync(apkPath)) return { yes: true, reason: 'apk-missing' };
  const { fingerprint } = computeFingerprint();
  const state = readState();
  if (state.fingerprint !== fingerprint) return { yes: true, reason: 'mobile-changed', fingerprint };
  return { yes: false, fingerprint };
}

function runPublish(reason) {
  if (!autoEnabled()) return;
  if (publishing) return;
  if (!canBuild()) {
    console.warn('  APK auto: gradlew не найден — установите Android Studio');
    return;
  }

  const state = readState();
  const failCooldownMs = 20 * 60 * 1000;
  if (state.lastFailAt && Date.now() - Number(state.lastFailAt) < failCooldownMs) {
    return;
  }

  const check = needsPublish();
  if (!check.yes) return;

  const { fingerprint } = computeFingerprint();
  publishing = true;
  console.log(`  APK auto: сборка (${reason})…`);

  const child = spawn(process.execPath, [PUBLISH_SCRIPT], {
    cwd: path.join(__dirname),
    stdio: 'inherit',
    shell: false,
  });

  child.on('exit', (code) => {
    publishing = false;
    if (code === 0) {
      writeState({
        fingerprint,
        publishedAt: new Date().toISOString(),
        version: readApkVersion(),
        lastFailAt: null,
      });
      console.log(`  APK auto: готово v${readApkVersion() || '?'}`);
    } else {
      writeState({ lastFailAt: Date.now(), lastFailReason: reason });
      console.warn('  APK auto: сборка не удалась (повтор через 20 мин)');
    }
  });
}

function readApkVersion() {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(MOBILE, 'apk-version.json'), 'utf8'));
    return info.version;
  } catch {
    return null;
  }
}

function schedulePublish(reason) {
  if (!autoEnabled()) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runPublish(reason), 10000);
}

function startWatcher() {
  if (!autoEnabled()) {
    console.log('  APK auto: выключен (VC_AUTO_APK_PUBLISH=false)');
    return;
  }
  if (!fs.existsSync(MOBILE)) return;
  if (!canBuild()) {
    console.log('  APK auto: ждёт Android SDK (gradlew.bat)');
    return;
  }

  try {
    fs.watch(MOBILE, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const base = path.basename(String(filename));
      if (SKIP_FILES.has(base)) return;
      schedulePublish(`изменён ${base}`);
    });
  } catch (e) {
    console.warn('  APK auto: watch недоступен:', e.message || e);
  }

  setTimeout(() => runPublish('старт сервера'), 8000);
  console.log('  APK auto: включён — версия +1 при изменении мобилки');
}

module.exports = { startWatcher, schedulePublish, runPublish, computeFingerprint };
