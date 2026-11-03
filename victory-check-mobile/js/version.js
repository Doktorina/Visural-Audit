/** Версия на экране (обновляется автоматически publish-apk.js) */
const VC_LABEL_VERSION = '1.2.131';
const VC_VERSION = '1.2.131';
const VC_BUILD = 140;
const VC_APP_NAME = 'Visural Audit v1.2.131';

function applyVersionLabels() {
  document.querySelectorAll('[data-app-version]').forEach((el) => {
    el.textContent = `v${VC_LABEL_VERSION}`;
  });
  document.querySelectorAll('[data-app-name]').forEach((el) => {
    el.textContent = VC_APP_NAME;
  });
  document.title = VC_APP_NAME;
  document.querySelectorAll('[data-app-build]').forEach((el) => {
    el.textContent = `сборка ${VC_BUILD}`;
  });
  document.querySelectorAll('[data-app-update]').forEach((el) => {
    el.textContent = `· обновление v${VC_VERSION}`;
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyVersionLabels);
} else {
  applyVersionLabels();
}
