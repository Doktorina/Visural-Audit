/* Visural Audit — мобильное PWA */

const IS_ANDROID_APP = !!(window.VC_ANDROID_APP || /android_asset/i.test(location.href || ''));

function isIosDevice() {
  return (
    /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

if ('serviceWorker' in navigator && !IS_ANDROID_APP && !isIosDevice()) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => {
      if (r.active?.scriptURL?.includes('sw.js')) r.update();
    });
  });
}

let store = ensureStoreArrays(loadStore());
let apiMode = false;
const SERVER_ONLY = true;
/** Временно: письма на корпоративный адрес (как на сервере). */
const TEMP_EMAIL_RECIPIENT = '';
const USE_TEMP_EMAIL_RECIPIENT = false;
let currentFilter = 'all';
let searchQuery = '';
let wizard = {};
let wizardStep = 0;
let wizardObjectOpen = false;
let wizardResponsibleOpen = false;
let detailId = null;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const _actionBusy = new Set();

function actionKey(parts) {
  return parts.filter(Boolean).join(':');
}

function beginActionBusy(key) {
  if (_actionBusy.has(key)) return false;
  _actionBusy.add(key);
  return true;
}

function endActionBusy(key) {
  _actionBusy.delete(key);
}

function setButtonBusy(btn, busy, busyLabel) {
  if (!btn) return;
  btn.disabled = busy;
  btn.classList.toggle('is-busy', busy);
  btn.setAttribute('aria-busy', busy ? 'true' : 'false');
  if (busy && busyLabel) {
    if (!btn.dataset.busyPrevLabel) btn.dataset.busyPrevLabel = btn.textContent;
    btn.textContent = busyLabel;
  } else if (btn.dataset.busyPrevLabel) {
    btn.textContent = btn.dataset.busyPrevLabel;
    delete btn.dataset.busyPrevLabel;
  }
}

async function withActionGuard(key, fn, { busyEl, busyLabel } = {}) {
  if (!beginActionBusy(key)) {
    return { skipped: true };
  }
  setButtonBusy(busyEl, true, busyLabel);
  try {
    return await fn();
  } finally {
    endActionBusy(key);
    setButtonBusy(busyEl, false);
  }
}

function initDetailActions() {
  const bar = $('#detail-actions');
  if (!bar || bar.dataset.delegated === '1') return;
  bar.dataset.delegated = '1';
  bar.addEventListener(
    'click',
    (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn || btn.disabled || !detailId) return;
      e.preventDefault();
      handleDetailAction(detailId, btn.dataset.action, btn).catch((err) =>
        toast(err.message || 'Ошибка')
      );
    },
    { passive: false }
  );
}

function initViolationsList() {
  const list = $('#violations-list');
  if (!list || list.dataset.delegated === '1') return;
  list.dataset.delegated = '1';
  list.addEventListener('click', (e) => {
    const card = e.target.closest('.ticket-card[data-id]');
    if (!card) return;
    openDetail(card.dataset.id);
  });
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

/** URL фото с сервера или data: */
function mediaUrl(src) {
  if (!src) return '';
  const s = String(src);
  if (s.startsWith('data:') || /^https?:\/\//i.test(s)) return s;
  if (s.startsWith('/')) {
    const origin = window.location.origin.replace(/\/$/, '');
    if (origin && origin !== 'null') return origin + s;
    const base = (VictoryAPI.getServerUrl && VictoryAPI.getServerUrl()) || 'https://audit.visural.ru';
    return base.replace(/\/$/, '') + s;
  }
  return s;
}

function persist() {
  ensureStoreArrays(store);
  if (store.user) {
    try {
      localStorage.setItem('vc_login_user', JSON.stringify(store.user));
    } catch (_) {}
  }
  try {
    const payload = apiMode
      ? {
          user: store.user,
          violations: store.violations,
          notifications: store.notifications,
          seq: store.seq,
          notifyEnabled: store.notifyEnabled,
          notifySettings: store.notifySettings,
          notifyEmail: store.notifyEmail,
        }
      : store;
    const ok = saveStoreSafe(payload);
      if (!ok && typeof toast === 'function') {
        toast('Память телефона заполнена — старые фото урезаны');
      }
    } catch (e) {
    if (typeof toast === 'function') toast(e.message || 'Не удалось сохранить данные');
  }
}

function isTrainingTicket(v) {
  return String(v?.description || '').includes('[TRAINING_CONTRACTOR]');
}

function isPracticeTicket(v) {
  return String(v?.description || '').includes('[TRAINING_PRACTICE]');
}

function isOnboardingTicket(v) {
  return isTrainingTicket(v) || isPracticeTicket(v);
}

const TRAINING_BANNER_HTML =
  '<strong>🎓 Учебный тикет</strong> Это тренировка: письма, push и Telegram никому не отправляются.';

function cleanTrainingDescription(text) {
  return String(text || '')
    .replace(/^\[TRAINING_PRACTICE\]\s*/i, '')
    .replace(/^\[TRAINING_CONTRACTOR\]\s*/i, '')
    .trim();
}

function isTrainingWizardActive() {
  return !!window.VCOnboarding?.isActive?.();
}

function getDetailViolation() {
  if (!detailId) return null;
  return store.violations.find((x) => x.id === detailId) || null;
}

function setTrainingModalNote(el, show) {
  el?.classList.toggle('hidden', !show);
}

function isTrainingTicketForMe(v) {
  if (!isTrainingTicket(v) || !store.user) return false;
  return String(v.responsibleUserId || '') === String(store.user.id || '');
}

function isPracticeTicketForMe(v) {
  if (!isPracticeTicket(v) || !store.user) return false;
  return String(v.createdByUserId || '') === String(store.user.id || '');
}

async function syncViolations(opts = {}) {
  if (!apiMode) return;
  const data = await VictoryAPI.getViolations(
    opts.full
      ? { filter: 'history' }
      : { filter: currentFilter, search: searchQuery }
  );
  store.violations = Array.isArray(data.violations) ? data.violations : [];
  persist();
}

function readCachedLoginUser() {
  if (store.user) return store.user;
    try {
    const raw = localStorage.getItem('vc_login_user');
    if (raw) return JSON.parse(raw);
    } catch (_) {}
  return null;
}

function hasPersistedSession() {
  return !!(VictoryAPI.getToken() && readCachedLoginUser());
}

function clearAuthSession() {
  store.user = null;
  VictoryAPI.setToken(null);
  try {
    localStorage.removeItem('vc_login_user');
    localStorage.removeItem('vc_offline_mode');
  } catch (_) {}
}

function restoreCachedSession() {
  const cached = readCachedLoginUser();
  if (cached && !store.user) store.user = cached;
  return hasPersistedSession();
}

function isAuthErrorMessage(msg, status) {
  if (status === 401) return true;
  const m = String(msg || '').toLowerCase();
  return /unauthorized|сессия истекла|invalid token|недействител.*токен/.test(m);
}

function resetLocalDemoData() {
  store.user = null;
  store.violations = [];
  store.notifications = [];
  try {
    localStorage.removeItem('vc_login_user');
    localStorage.removeItem('vc_offline_mode');
    localStorage.removeItem(STORAGE_KEY);
  } catch (_) {}
}

async function loadFromServer() {
  const [objs, cons] = await Promise.all([VictoryAPI.getObjects(), VictoryAPI.getContractors()]);
  const objects = Array.isArray(objs.objects) ? objs.objects : [];
  const contractors = Array.isArray(cons.contractors) ? cons.contractors : [];
  if (!objects.length && !contractors.length) {
    throw new Error('Сервер не вернул справочники');
  }
  if (objects.length) setRefs(objects, contractors);
  else if (contractors.length) setRefs(REF_OBJECTS, contractors);
  saveLocalDirectories({ objects, contractors, syncedAt: Date.now() });
  if (typeof loadCategoriesFromApi === 'function') {
    await loadCategoriesFromApi().catch(() => {});
  }
  await syncViolations({ full: true });
  await loadNotifications().catch(() => {});
          persist();
}

async function tryLoadFromServer(opts = {}) {
  if (!apiMode || !VictoryAPI.getToken()) return false;
  try {
    await loadFromServer();
    return true;
  } catch (e) {
    if (opts.silent) return false;
    const cached = loadStore();
    if (Array.isArray(cached.violations) && cached.violations.length) {
      store.violations = cached.violations;
      if (Array.isArray(cached.notifications)) store.notifications = cached.notifications;
      toast('Нет связи с сервером — показаны сохранённые данные');
      return false;
    }
    throw e;
  }
}

async function ensureDirectoriesLoaded(opts = {}) {
  const force = !!opts.force;
  if (!apiMode) {
    if (!REF_OBJECTS.length) {
      const demo = loadLocalDirectories({ useDemo: true });
      setRefs(demo.objects, demo.contractors);
    }
    return;
  }
  if (!force && REF_OBJECTS.length) return;
  try {
    if (force) {
      await refreshDirectories();
      return;
    }
    await loadFromServer();
  } catch (e) {
    if (!force && REF_OBJECTS.length) return;
    const cached = loadLocalDirectories();
    if (cached.objects?.length) {
      setRefs(cached.objects, cached.contractors || []);
      toast('Показаны сохранённые объекты. Проверьте интернет для обновления.');
      return;
    }
    throw e;
  }
}

async function initApp() {
  if ('serviceWorker' in navigator) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    } catch (_) {}
  }

  setupServerConfigUi();
  try {
    localStorage.removeItem('vc_offline_mode');
  } catch (_) {}

  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get('token');
  if (urlToken) {
    VictoryAPI.setToken(urlToken);
    sessionStorage.setItem('vc_mode', 'mobile');
    history.replaceState({}, '', window.location.pathname);
  }

  let cachedUser = readCachedLoginUser();
  if (cachedUser && !store.user) store.user = cachedUser;
  hydrateRefsFromCache();

  try {
    await VictoryAPI.check();
    apiMode = VictoryAPI.enabled;
  } catch (_) {
    apiMode = false;
  }

  if (!apiMode) {
    if (restoreCachedSession()) {
      boot();
      handleGmailRedirect();
      return;
    }
    resetLocalDemoData();
    boot();
    handleGmailRedirect();
    return;
  }

  const token = VictoryAPI.getToken();
  if (token) {
    try {
      const { user } = await VictoryAPI.me();
      store.user = user;
      try {
        localStorage.setItem('vc_login_user', JSON.stringify(user));
      } catch (_) {}
      persist();
      if (apiMode) {
        await tryLoadFromServer({ silent: true });
      }
      boot();
      handleGmailRedirect();
      return;
    } catch (e) {
      const msg = (e && e.message) || '';
      if (isAuthErrorMessage(msg, e.status)) {
        clearAuthSession();
        resetLocalDemoData();
        toast('Сессия истекла — войдите снова');
        boot();
        handleGmailRedirect();
        return;
      }
      if (cachedUser || store.user || hasPersistedSession()) {
        store.user = cachedUser || store.user || readCachedLoginUser();
        persist();
        await tryLoadFromServer({ silent: true });
        boot();
        handleGmailRedirect();
        if (msg) toast('Нет связи с сервером — используем сохранённые данные');
        return;
      }
    }
  }

  if (hasPersistedSession()) {
    restoreCachedSession();
    await tryLoadFromServer({ silent: true });
    boot();
    handleGmailRedirect();
    return;
  }

  store.user = null;
  boot();
  handleGmailRedirect();
}

window.vcFinishLogin = async function (data) {
  if (!data || !data.user) {
    toast('Ошибка: нет данных пользователя');
    return;
  }
  store.user = data.user;
  apiMode = true;
  const errEl = document.getElementById('login-error');
  if (errEl) errEl.textContent = '';
  try {
    localStorage.setItem('vc_login_user', JSON.stringify(data.user));
    sessionStorage.setItem('vc_mode', 'mobile');
      localStorage.removeItem('vc_offline_mode');
      VictoryAPI.setToken(data.token);
  } catch (_) {}
  persist();
  try {
    await loadFromServer();
    } catch (e) {
    const msg = (e && e.message) || '';
    if (/авторизац/i.test(msg) || /Unauthorized/i.test(msg) || e.status === 401) {
      store.user = null;
      VictoryAPI.setToken(null);
      try {
        localStorage.removeItem('vc_login_user');
      } catch (_) {}
      toast('Сессия истекла — войдите снова');
      showScreen('login');
      return;
    }
    await tryLoadFromServer({ silent: true });
      console.warn('load after login:', e.message);
    }
  if (needsApproval()) {
    routeAfterLogin(data.message || 'Заявка отправлена администратору');
    return;
  }
  $$('.nav-item').forEach((b) => b.classList.remove('active'));
  const listNav = $$('.nav-item[data-screen="list"]')[0];
  if (listNav) listNav.classList.add('active');
  routeAfterLogin('');
};

function setupServerConfigUi() {
  if (VictoryAPI.isServerDeploy() || VictoryAPI.isLocalHost()) {
    VictoryAPI.setServerUrl(window.location.origin.replace(/\/$/, ''));
    return;
  }
  VictoryAPI.setServerUrl('https://audit.visural.ru');
}

$('#btn-goto-register')?.addEventListener('click', () => {
  setupServerConfigUi();
  showScreen('register');
});

$('#register-back')?.addEventListener('click', () => showScreen('login'));

async function refreshApiConnection() {
  setupServerConfigUi();
  await VictoryAPI.check();
  apiMode = VictoryAPI.enabled;
  return apiMode;
}

function handleGmailRedirect() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('connect') === 'gmail' && store.user) {
    history.replaceState({}, '', window.location.pathname);
    showScreen('notification-settings');
    renderNotificationSettingsScreen().catch(() => {});
  }
  if (params.get('gmail') === 'connected') {
    toast('Gmail подключён — можно отправлять письма');
    history.replaceState({}, '', window.location.pathname);
    if (store.user) {
      store.user.googleConnected = true;
      store.googleConnected = true;
      store.sendToAnyone = true;
      persist();
    }
    VictoryAPI.me()
      .then(({ user }) => {
        store.user = user;
        persist();
      })
      .catch(() => {});
  } else if (params.get('gmail') === 'error') {
    const msg = params.get('msg');
    toast(msg ? decodeURIComponent(msg) : 'Не удалось подключить Gmail');
    history.replaceState({}, '', window.location.pathname);
  }
}

function userPerms() {
  const p = store.user?.permissions;
  if (p) return p;
  const role = store.user?.role || 'auditor';
  const status = store.user?.status || 'active';
  if (status === 'pending' || status === 'rejected') {
    return {
      adminPanel: false,
      createViolation: false,
      editStatus: false,
      comment: false,
      report: false,
      manageDirectories: false,
      share: false,
      viewAllViolations: false,
    };
  }
  return {
    adminPanel: role === 'admin',
    createViolation: role === 'admin' || role === 'auditor',
    editStatus: role === 'admin' || role === 'auditor',
    comment: role === 'admin' || role === 'auditor' || role === 'contractor',
    report: role === 'admin' || role === 'auditor' || role === 'contractor' || role === 'viewer',
    manageDirectories: role === 'admin' || role === 'auditor',
    share: role === 'admin' || role === 'auditor',
    viewAllViolations: role === 'admin' || role === 'auditor' || role === 'viewer',
  };
}

function isAdminUser() {
  return store.user?.role === 'admin' || userPerms().adminPanel;
}

function applyAvatarEl(el, user) {
  if (!el || !user) return;
  if (user.avatarUrl) {
    el.style.backgroundImage = `url(${user.avatarUrl})`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.textContent = '';
    el.classList.add('has-photo');
  } else {
    el.style.backgroundImage = '';
    el.classList.remove('has-photo');
    el.textContent = user.initials || 'VC';
  }
}

function updateAvatars() {
  const u = store.user;
  if (!u) return;
  applyAvatarEl($('#user-avatar'), u);
  applyAvatarEl($('#profile-avatar'), u);
}

function applyRoleUI() {
  const p = userPerms();
  const analyticsNav = $('.nav-item[data-screen="analytics"]');
  if (analyticsNav) {
    analyticsNav.style.display = p.viewAllViolations ? '' : 'none';
  }
  $('#goto-settings-objects')?.classList.toggle('hidden', !p.manageDirectories);
  $('#goto-settings-contractors')?.classList.toggle('hidden', !p.manageDirectories);
  $('#goto-notification-settings')?.classList.toggle('hidden', !p.createViolation);
  const settingsBlock = $('#goto-settings-objects')?.closest('.info-block');
  if (settingsBlock && !p.manageDirectories && !p.createViolation) {
    settingsBlock.classList.add('hidden');
  } else if (settingsBlock) {
    settingsBlock.classList.remove('hidden');
  }
  $('#analytics-admin-hint')?.classList.toggle('hidden', !isAdminUser());
}

function enterApp() {
  ensureStoreArrays(store);
  if ('serviceWorker' in navigator && !IS_ANDROID_APP && !isIosDevice()) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  tryLoadFromServer({ silent: true }).catch(() => {});
  ensureDirectoriesLoaded().catch((e) => toast(e.message || 'Не удалось загрузить справочники'));
  showScreen('list');
  updateAvatars();
  const dot = $('.badge-dot');
  if (dot) {
    dot.classList.toggle(
      'has-notify',
      store.notifications.some((n) => !(n.isRead || n.read))
    );
  }
  applyRoleUI();
  if (apiMode) startLiveDataSync();
  if (window.VCPushNotify && store.user) {
    VCPushNotify.ensurePermission().catch(() => {});
    VCPushNotify.processNotifications(store.notifications, store.user.id);
    VCPushNotify.startPolling(async () => {
      await loadNotifications().catch(() => {});
      if (dot) {
        dot.classList.toggle(
          'has-notify',
          store.notifications.some((n) => !(n.isRead || n.read))
        );
      }
      renderNotificationsFeed();
    }, 45000);
  }
  if (window.VCOnboarding) {
    requestAnimationFrame(() => VCOnboarding.maybeStartAfterLogin());
  }
}

function showRoleChoice() {
  enterApp();
}

function showScreen(id) {
  $$('.screen').forEach((s) => s.classList.remove('active'));
  const screen = $(`#screen-${id}`);
  if (screen) screen.classList.add('active');

  const hideNav = [
    'login',
    'register',
    'forgot-password',
    'pending',
    'rejected',
    'role-choice',
    'wizard',
    'detail',
    'settings-objects',
    'settings-contractors',
    'notification-settings',
    'profile-edit',
    'help',
  ].includes(id);
  $('.bottom-nav')?.classList.toggle('hidden', hideNav);
  const canCreate = userPerms().createViolation;
  $('#fab')?.classList.toggle('hidden', id !== 'list' || !canCreate);

  if (id === 'list') {
    if (apiMode) refreshDirectories().catch(() => {});
    renderList().catch((e) => toast(e.message));
  }
  if (id === 'analytics') renderAnalytics().catch((e) => toast(e.message));
  if (id === 'profile') renderProfile();
  if (id === 'help') window.VCOnboarding?.renderHelpScreen();
  if (id === 'profile-edit') renderProfileEditForm();
  if (id === 'notification-settings') {
    renderNotificationSettingsScreen().catch((e) => toast(e.message));
  }
  if (id === 'settings-objects') renderObjectsSettings().catch((e) => toast(e.message));
  if (id === 'settings-contractors') renderContractorsSettings().catch((e) => toast(e.message));
  if (id === 'detail' && detailId) renderDetail(detailId).catch((e) => toast(e.message));
  if (id === 'wizard') {
    refreshLiveData({ silent: true }).catch(() => {});
    renderWizard();
  }

  const showTopMenu = !!store.user;
  $('#app-chrome-menu')?.classList.toggle('hidden', !showTopMenu);
  if (!showTopMenu) closeAppMenu();
}

function closeAppMenu() {
  $('#app-menu-dropdown')?.classList.add('hidden');
  $('#btn-app-menu')?.setAttribute('aria-expanded', 'false');
}

function initAppMenu() {
  $('#btn-app-menu')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const panel = $('#app-menu-dropdown');
    const open = panel?.classList.toggle('hidden') === false;
    $('#btn-app-menu')?.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  document.addEventListener('click', () => closeAppMenu());
  $('#app-chrome-menu')?.addEventListener('click', (e) => e.stopPropagation());
}

function initNav() {
  $$('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.nav-item').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      showScreen(btn.dataset.screen);
    });
  });
}

function boot() {
  ensureStoreArrays(store);
  restoreCachedSession();
  const token = VictoryAPI.getToken();
  if ((!store.user || !token) && hasPersistedSession()) {
    restoreCachedSession();
  }
  if (store.user && VictoryAPI.getToken()) {
    sessionStorage.setItem('vc_mode', 'mobile');
    if (isUserRejected()) {
      showScreen('rejected');
      return;
    }
    if (needsApproval()) {
      showPendingList();
      return;
    }
    enterApp();
    return;
  }
  store.user = null;
    showScreen('login');
}

/* ——— Login: js/login.js ——— */

function doLogout() {
  closeAppMenu();
  window.VCPushNotify?.stopPolling();
  clearAuthSession();
  store.violations = [];
  store.notifications = [];
  persist();
  $('#app-chrome-menu')?.classList.add('hidden');
  showScreen('login');
}

$('#menu-logout')?.addEventListener('click', doLogout);

$('#btn-pending-logout')?.addEventListener('click', doLogout);
$('#btn-rejected-logout')?.addEventListener('click', doLogout);

async function refreshPendingStatus() {
  try {
    const { user } = await VictoryAPI.me();
    store.user = user;
    persist();
    if (isUserRejected()) {
      showScreen('rejected');
      toast('Заявка отклонена');
      return;
    }
    if (needsApproval()) {
      showPendingList();
      toast('Ещё ожидает подтверждения');
      return;
    }
    toast('Доступ подтверждён');
    await loadFromServer();
    routeAfterLogin('');
  } catch (e) {
    toast(e.message || 'Не удалось проверить статус');
  }
}

$('#btn-pending-refresh')?.addEventListener('click', refreshPendingStatus);

$('#btn-go-mobile')?.addEventListener('click', () => {
  sessionStorage.setItem('vc_mode', 'mobile');
  enterApp();
});

/* ——— List ——— */
function collectExecutorNames() {
  const names = new Set();
  REF_CONTRACTORS.forEach((c) => {
    if (c.executor?.trim()) names.add(c.executor.trim());
  });
  ensureStoreArrays(store);
  store.violations.forEach((v) => {
    if (v.responsible?.trim()) names.add(v.responsible.trim());
  });
  return [...names].sort((a, b) => a.localeCompare(b, 'ru'));
}

function updateExecutorsDatalist() {
  const list = $('#executors-datalist');
  if (!list) return;
  list.innerHTML = collectExecutorNames()
    .map((n) => `<option value="${escapeHtml(n)}"></option>`)
    .join('');
}

function isClosedViolation(v) {
  return (v?.status || '') === 'resolved';
}

function userCoversObject(objectId) {
  const ids = store.user?.objectIds;
  if (!Array.isArray(ids) || !ids.length) return true;
  return ids.map(String).includes(String(objectId));
}

function isContractorUser() {
  return !!((store.user?.contractorId || store.user?.company) && !userPerms().viewAllViolations);
}

async function renderList() {
  ensureStoreArrays(store);
  if (apiMode) {
    try {
      await syncViolations({ full: true });
    } catch (_) {}
  }
  let items = [...store.violations];
  items.forEach((v) => {
    if (isOverdue(v) && v.status !== 'resolved' && v.status !== 'verification') v.status = 'overdue';
  });

  if (isContractorUser()) {
    items = items.filter((v) => {
      if (isTrainingTicketForMe(v)) return true;
      if (store.user.contractorId && v.contractorId !== store.user.contractorId) return false;
      return userCoversObject(v.objectId);
    });
  }

  if (currentFilter === 'critical') {
    items = items.filter((v) => isDeadlineCritical(v) && !isClosedViolation(v));
  } else if (currentFilter === 'overdue') {
    items = items.filter(
      (v) => (v.status === 'overdue' || isOverdue(v)) && !isClosedViolation(v)
    );
  } else if (currentFilter === 'in_progress') {
    items = items.filter(
      (v) =>
        (v.status === 'in_progress' || v.status === 'new' || v.status === 'verification') &&
        !isClosedViolation(v)
    );
  } else if (currentFilter === 'resolved') {
    items = items.filter((v) => isClosedViolation(v));
  } else if (currentFilter === 'all') {
    items = items.filter((v) => !isClosedViolation(v));
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    items = items.filter((v) => {
      const obj = getObject(v.objectId)?.name || '';
      const org = getContractor(v.contractorId)?.name || '';
      return (
        v.number.toLowerCase().includes(q) ||
        v.description.toLowerCase().includes(q) ||
        obj.toLowerCase().includes(q) ||
        org.toLowerCase().includes(q)
      );
    });
  }

  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const list = $('#violations-list');
  if (!items.length) {
    if (needsApproval()) {
      const u = store.user || {};
      list.innerHTML = `
      <div class="empty-state pending-empty">
        <div class="icon">📋</div>
        <p>Нарушений не найдено</p>
        <p style="font-size:0.9rem;margin:8px 0 16px">Дождитесь подтверждения администратором</p>
        <div class="info-block" style="text-align:left;margin:0 auto 16px;max-width:320px">
          <div class="info-row"><span>ФИО</span><span>${escapeHtml(u.name || '—')}</span></div>
          <div class="info-row"><span>Компания</span><span>${escapeHtml(u.company || '—')}</span></div>
          <div class="info-row"><span>Телефон</span><span>${escapeHtml(u.phone || '—')}</span></div>
        </div>
        <button type="button" class="btn-secondary" id="btn-pending-refresh-inline" style="width:100%;max-width:320px">Проверить статус</button>
      </div>`;
      $('#btn-pending-refresh-inline')?.addEventListener('click', refreshPendingStatus);
      return;
    }
    list.innerHTML =
      currentFilter === 'resolved'
        ? emptyStateHtml('Выполненных нарушений нет', '')
        : emptyStateHtml('Нарушений не найдено', '');
    return;
  }

  list.innerHTML = items
    .map((v) => {
      const obj = getObject(v.objectId);
      const org = getContractor(v.contractorId);
      const cat = getCategory(v.categoryId, v);
      const overdue = isOverdue(v);
      const urgent = isDeadlineCritical(v);
      const catIcon = window.VCIcons
        ? VCIcons.categoryIcon(v.categoryId, { size: 18 })
        : escapeHtml(cat?.icon || '📋');
      let pillClass = v.status;
      let pillLabel = STATUS_LABELS[v.status] || v.status;
      if (overdue || v.status === 'overdue') {
        pillClass = 'overdue';
        pillLabel = 'Просрочено';
      } else if (urgent) {
        pillClass = 'critical';
        pillLabel = 'Критический';
      }
      const accentStatus =
        overdue || v.status === 'overdue'
          ? 'overdue'
          : urgent
            ? 'critical'
            : v.status;
      const training = isTrainingTicketForMe(v) || isPracticeTicketForMe(v);
      return `
      <article class="ticket-card card status-${accentStatus}${overdue ? ' is-overdue' : ''}${training ? ' ticket-card--training' : ''}" data-id="${v.id}"${training ? ' data-training="1"' : ''}>
        <div class="card-top">
          <span class="card-num">${escapeHtml(v.number)}${training ? ' <span class="training-badge">Учебный</span>' : ''}</span>
          <span class="status-pill ${pillClass}">${escapeHtml(pillLabel)}</span>
        </div>
        <div class="card-meta">${escapeHtml(obj?.name || '—')} · ${escapeHtml(org?.name || '—')}</div>
        <div class="card-desc">
          <span class="card-cat-icon" aria-hidden="true">${catIcon}</span>
          <p class="card-desc-text"><span class="card-cat-name">${escapeHtml(cat?.name || 'Другое')}:</span> ${escapeHtml(v.description)}</p>
        </div>
        <div class="card-deadline${overdue ? ' overdue' : ''}">
          Срок: ${formatDate(v.deadline)}${overdue ? ' · Просрочено' : ''}
        </div>
      </article>`;
    })
    .join('');

  initViolationsList();
}

function emptyStateHtml(title, hint, iconName = 'clipboard') {
  const icon = window.VCIcons ? VCIcons.svg(iconName, { size: 32 }) : '📋';
  return `<div class="empty-state">
    <div class="empty-state-icon">${icon}</div>
    <p class="empty-state-title">${escapeHtml(title)}</p>
    ${hint ? `<p class="empty-state-hint">${escapeHtml(hint)}</p>` : ''}
  </div>`;
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function profileNameLines(u) {
  if (!u) return { line1: '—', line2: '', line3: '' };
  const fn = String(u.firstName || '').trim();
  const ln = String(u.lastName || '').trim();
  if (fn || ln) {
    const lnParts = ln.split(/\s+/).filter(Boolean);
    return {
      line1: fn || lnParts[0] || '—',
      line2: fn ? lnParts[0] || '' : lnParts[1] || '',
      line3: fn ? lnParts.slice(1).join(' ') : lnParts.slice(2).join(' ') || '',
    };
  }
  const parts = String(u.name || '').trim().split(/\s+/).filter(Boolean);
  return {
    line1: parts[0] || '—',
    line2: parts[1] || '',
    line3: parts.slice(2).join(' ') || '',
  };
}

function setProfileNameLines(u) {
  const lines = profileNameLines(u);
  const l1 = $('#profile-name-line1');
  const l2 = $('#profile-name-line2');
  const l3 = $('#profile-name-line3');
  if (l1) l1.textContent = lines.line1;
  if (l2) {
    l2.textContent = lines.line2;
    l2.classList.toggle('hidden', !lines.line2);
    l2.classList.toggle('profile-name-muted', !!lines.line2);
  }
  if (l3) {
    l3.textContent = lines.line3;
    l3.classList.toggle('hidden', !lines.line3);
    l3.classList.toggle('profile-name-muted', !!lines.line3);
  }
}

$('#search-input')?.addEventListener('input', (e) => {
  searchQuery = e.target.value;
  renderList().catch((err) => toast(err.message));
});

$$('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    $$('.chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    currentFilter = chip.dataset.filter;
    renderList().catch((err) => toast(err.message));
  });
});

$('#fab')?.addEventListener('click', startWizard);

/* ——— Wizard ——— */
const WIZARD_STEPS = 8;

const WIZARD_GUIDE = [
  'Выберите объект, на котором обнаружено нарушение.',
  'Выберите организацию, ответственную за этот объект. Затем выберите ответственного сотрудника из списка ниже.',
  'Выберите категорию нарушения.',
  'Приложите фото: нажмите «+» и сделайте снимок или выберите из галереи.',
  'Опишите проблему — что именно нарушено.',
  'Укажите нормативный документ и пункт нарушения.',
  'Выберите критичность нарушения.',
  'Проверьте данные и нажмите «Создать» для отправки акта.',
];

function isUserPending() {
  return String(store.user?.status || 'active').toLowerCase() === 'pending';
}

function needsApproval() {
  if (!store.user || isUserRejected()) return false;
  if (isUserPending()) return true;
  const role = String(store.user.role || '').toLowerCase();
  if (role === 'viewer' && !userPerms().viewAllViolations) return true;
  return false;
}

function isUserRejected() {
  return String(store.user?.status || 'active').toLowerCase() === 'rejected';
}

function updatePendingApprovalUi() {
  /* кнопка подтверждения убрана — админ уведомляется при регистрации */
}

async function requestUserApproval() {
  /* deprecated */
}

function showPendingList() {
  $$('.nav-item').forEach((b) => b.classList.remove('active'));
  $$('.nav-item[data-screen="list"]')[0]?.classList.add('active');
  enterApp();
  updatePendingApprovalUi();
}

function showPendingScreen() {
  const u = store.user;
  if ($('#pending-name')) $('#pending-name').textContent = u?.name || '—';
  if ($('#pending-company')) $('#pending-company').textContent = u?.company || '—';
  if ($('#pending-email')) $('#pending-email').textContent = u?.company || '—';
  if ($('#pending-phone')) $('#pending-phone').textContent = u?.phone || '—';
  showScreen('pending');
  updatePendingApprovalUi();
}

function routeAfterLogin(message) {
  if (isUserRejected()) {
    showScreen('rejected');
    if (message) toast(message);
    return;
  }
  if (needsApproval()) {
    showPendingList();
    if (message) toast(message);
    return;
  }
  enterApp();
  if (message && message !== 'Добро пожаловать') toast(message);
}

async function startWizard() {
  try {
    await ensureDirectoriesLoaded({ force: true });
  } catch (e) {
    toast(e.message || 'Не удалось загрузить объекты');
    return;
  }
  if (!REF_OBJECTS.length) {
    toast('Нет объектов на сервере. Добавьте в настройках или обратитесь к администратору.');
    return;
  }
  wizard = { media: [] };
  wizardStep = 0;
  wizardObjectOpen = false;
  wizardResponsibleOpen = false;
  window.VCOnboarding?.handleEvent?.('wizard-opened');
  showScreen('wizard');
}

function compressImageFile(file, maxSide = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width;
      let h = img.height;
      const scale = Math.min(1, maxSide / Math.max(w, h));
      w = Math.round(w * scale);
      h = Math.round(h * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas недоступен'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Не удалось прочитать фото'));
    };
    img.src = url;
  });
}

function renderWizard() {
  const steps = $('#wizard-progress');
  steps.innerHTML = Array.from({ length: WIZARD_STEPS }, (_, i) => {
    let cls = '';
    if (i < wizardStep) cls = 'done';
    if (i === wizardStep) cls = 'current';
    return `<span class="${cls}" data-step="${i}" role="button" aria-label="Шаг ${i + 1}"></span>`;
  }).join('');
  steps.querySelectorAll('[data-step]').forEach((el) => {
    el.addEventListener('click', () => {
      const i = Number(el.dataset.step);
      if (i < wizardStep) {
        wizardStep = i;
        renderWizard();
      }
    });
  });

  const titles = [
    'Объект',
    'Организация',
    'Категория',
    'Фото',
    'Описание',
    'Нормативный документ',
    'Критичность нарушений',
    'Подтверждение',
  ];
  $('#wizard-title').textContent = `Шаг ${wizardStep + 1}: ${titles[wizardStep]}`;

  const body = $('#wizard-body');
  const back = $('#wizard-back');
  const next = $('#wizard-next');

  back.style.visibility = 'visible';
  back.style.opacity = '1';
  back.textContent = wizardStep === 0 ? '‹' : '‹';
  back.title = wizardStep === 0 ? 'К списку нарушений' : 'Предыдущий шаг';
  next.textContent = wizardStep === WIZARD_STEPS - 1 ? 'Создать' : 'Далее';

  if (wizardStep === 0) {
    body.innerHTML = renderObjectPickerStep();
    bindObjectPickerStep();
  } else if (wizardStep === 1) {
    wizard.contractorId = wizard.contractorId || REF_CONTRACTORS[0]?.id;
    body.innerHTML = `
      <p class="wizard-label">Выберите организацию</p>
      <div class="picker-list" id="w-contractor-list">
        ${REF_CONTRACTORS.map(
          (c) =>
            `<button type="button" class="picker-item ${wizard.contractorId === c.id ? 'selected' : ''}" data-id="${c.id}">
              <span>
                <span class="picker-item-title">${escapeHtml(c.name)}</span>
                ${c.inn || c.executor ? `<span class="picker-item-sub">${c.inn ? 'ИНН ' + escapeHtml(c.inn) : ''}${c.inn && c.executor ? ' · ' : ''}${c.executor ? escapeHtml(c.executor) : ''}</span>` : ''}
              </span>
            </button>`
        ).join('')}
      </div>
      <div class="form-group" style="margin-top:16px">
        <p class="wizard-label" style="margin-bottom:8px">Ответственный на объекте</p>
        <div id="w-responsible-wrap"><p class="wizard-hint">Загрузка…</p></div>
        <p id="w-responsible-hint" class="wizard-hint"></p>
      </div>`;
    body.querySelectorAll('#w-contractor-list .picker-item').forEach((btn) => {
      btn.onclick = async () => {
        wizard.contractorId = btn.dataset.id;
        wizard.responsibleUserId = null;
        wizardResponsibleOpen = false;
        body.querySelectorAll('#w-contractor-list .picker-item').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        await refreshWizardResponsibleSelect();
      };
    });
    refreshWizardResponsibleSelect();
  } else if (wizardStep === 2) {
    body.innerHTML = `<p class="wizard-label">Категория нарушения</p>
    <div class="category-grid" id="w-categories">
      ${CATEGORIES.map(
        (c) =>
          `<button type="button" class="category-item ${wizard.categoryId === c.id ? 'selected' : ''}" data-id="${c.id}">
            <span class="cat-icon-wrap">${window.VCIcons ? VCIcons.categoryIcon(c.id, { size: 20 }) : ''}</span>
            <span class="cat-title">${escapeHtml(c.name)}</span>
          </button>`
      ).join('')}
    </div>
    <div class="form-group ${wizard.categoryId === 'other' ? '' : 'hidden'}" id="w-category-other-wrap" style="margin-top:14px">
      <label for="w-category-other" style="font-size:0.85rem;color:var(--muted);display:block;margin-bottom:6px">Укажите категорию</label>
      <input id="w-category-other" type="text" placeholder="Введите название категории" value="${escapeHtml(wizard.categoryOther || '')}">
    </div>`;
    body.querySelectorAll('.category-item').forEach((btn) => {
      btn.onclick = () => {
        wizard.categoryId = btn.dataset.id;
        body.querySelectorAll('.category-item').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        const wrap = $('#w-category-other-wrap');
        if (wrap) wrap.classList.toggle('hidden', wizard.categoryId !== 'other');
        if (wizard.categoryId === 'other') $('#w-category-other')?.focus();
      };
    });
    $('#w-category-other')?.addEventListener('input', (e) => {
      wizard.categoryOther = e.target.value.trim();
    });
    wizard.categoryId = wizard.categoryId || 'ppe';
  } else if (wizardStep === 3) {
    const canAdd = wizard.media.length < 10;
    body.innerHTML = `
      <p style="color:var(--muted);font-size:0.9rem;margin-bottom:12px">Минимум 1, максимум 10 фото. Нажмите + (камера или галерея).</p>
      <div class="media-grid" id="w-media">
        ${wizard.media
          .map(
            (m, i) =>
              `<div class="media-thumb-wrap"><img class="media-thumb" src="${mediaUrl(m)}" alt=""><button type="button" class="media-del" data-i="${i}" aria-label="Удалить">×</button></div>`
          )
          .join('')}
        ${
          canAdd
            ? window.VC_NATIVE
              ? `<button type="button" class="media-add" id="w-add-photo-native" aria-label="Добавить фото">+</button>`
              : `<label class="media-add" for="w-file" id="w-add-photo">+</label>
      <input type="file" id="w-file" class="media-file-input" accept="image/*" multiple>`
            : ''
        }
      </div>`;
    const nativePhotoBtn = $('#w-add-photo-native');
    if (nativePhotoBtn && typeof window.vcOpenWizardPhotoPicker === 'function') {
      nativePhotoBtn.onclick = (e) => {
        e.preventDefault();
        window.vcOpenWizardPhotoPicker();
      };
    }
    const fileInp = $('#w-file');
    if (fileInp) {
      fileInp.onchange = onWizardPhotos;
      fileInp.onclick = (e) => e.stopPropagation();
    }
    body.querySelectorAll('.media-del').forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        const idx = Number(btn.dataset.i);
        wizard.media.splice(idx, 1);
        renderWizard();
      };
    });
    getGeoLocation();
  } else if (wizardStep === 4) {
    body.innerHTML = `
      <div class="form-group">
        <label>Описание нарушения *</label>
        <textarea id="w-desc" placeholder="Опишите нарушение...">${wizard.description || ''}</textarea>
      </div>`;
    $('#w-desc').oninput = (e) => (wizard.description = e.target.value);
  } else if (wizardStep === 5) {
    if (!Array.isArray(wizard.normEntries) || !wizard.normEntries.length) {
      wizard.normEntries = [{ doc: '', clause: '' }];
    }
    body.innerHTML = `
      <p style="color:var(--muted);font-size:0.9rem;margin-bottom:12px">
        Укажите нормативный документ и пункт, который был нарушен.
      </p>
      <div id="w-norm-list"></div>
      <button type="button" class="btn-secondary" id="w-norm-add" style="width:100%;margin-top:10px">+ Добавить ещё пункт</button>`;
    const list = $('#w-norm-list');
    list.innerHTML = wizard.normEntries
      .map(
        (entry, i) => `
      <div class="info-block" style="margin-bottom:10px" data-norm-i="${i}">
        <div class="form-group">
          <label>Документ ${wizard.normEntries.length > 1 ? i + 1 : ''}</label>
          <input type="text" class="w-norm-doc" data-i="${i}" placeholder="ПОТ РМ-012-2000, СНиП 12-03-2001…" value="${escapeHtml(entry.doc || '')}">
        </div>
        <div class="form-group">
          <label>Пункт / раздел</label>
          <input type="text" class="w-norm-clause" data-i="${i}" placeholder="п. 12.3, § 4.2…" value="${escapeHtml(entry.clause || '')}">
        </div>
        ${wizard.normEntries.length > 1 ? `<button type="button" class="btn-secondary w-norm-del" data-i="${i}" style="width:100%">Удалить</button>` : ''}
      </div>`
      )
      .join('');
    body.querySelectorAll('.w-norm-doc').forEach((inp) => {
      inp.oninput = () => {
        wizard.normEntries[Number(inp.dataset.i)].doc = inp.value;
      };
    });
    body.querySelectorAll('.w-norm-clause').forEach((inp) => {
      inp.oninput = () => {
        wizard.normEntries[Number(inp.dataset.i)].clause = inp.value;
      };
    });
    body.querySelectorAll('.w-norm-del').forEach((btn) => {
      btn.onclick = () => {
        wizard.normEntries.splice(Number(btn.dataset.i), 1);
        renderWizard();
      };
    });
    $('#w-norm-add')?.addEventListener('click', () => {
      wizard.normEntries.push({ doc: '', clause: '' });
      renderWizard();
    });
  } else if (wizardStep === 6) {
    body.innerHTML = `<div class="severity-options" id="w-severity">
      ${SEVERITY.map(
        (s) => `
        <button type="button" class="severity-btn ${wizard.severity === s.id ? 'selected' : ''}" data-id="${s.id}">
          <strong>${s.label}</strong>
          <small>${s.hint}</small>
        </button>`
      ).join('')}
    </div>`;
    body.querySelectorAll('.severity-btn').forEach((btn) => {
      btn.onclick = () => {
        wizard.severity = btn.dataset.id;
        body.querySelectorAll('.severity-btn').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        updateWizardDeadlinePreview();
      };
    });
    wizard.severity = wizard.severity || 'major';
    updateWizardDeadlinePreview();
  } else if (wizardStep === 7) {
    const obj = getObject(wizard.objectId);
    const org = getContractor(wizard.contractorId);
    const cat =
      wizard.categoryId === 'other' && wizard.categoryOther
        ? { name: wizard.categoryOther }
        : getCategory(wizard.categoryId);
    const sev = SEVERITY.find((s) => s.id === wizard.severity);
    const deadline = calcDeadline(wizard.severity);
    if (wizard.notifyEmail === undefined) wizard.notifyEmail = true;
    if (wizard.notifyPush === undefined) wizard.notifyPush = true;
    if (wizard.notifyTelegram === undefined) wizard.notifyTelegram = true;
    const trainingWizard = isTrainingWizardActive();
    if (!trainingWizard) initWizardEmailRecipients(org);
    const responsibleMember = (wizard.contractorMembers || []).find(
      (m) => m.id === wizard.responsibleUserId
    );
    const responsibleEmail = memberDisplayEmail(responsibleMember);
    const recipientRows = trainingWizard
      ? ''
      : buildWizardEmailRecipientOptions(org)
          .map((o) => formatWizardEmailRecipientRow(o))
          .join('');
    body.innerHTML = `
      ${trainingWizard ? `<div class="wizard-training-note" role="note"><strong>Учебный акт</strong> На этом шаге ничего никуда не отправляется: ни email, ни push, ни Telegram. Это только тренировка.</div>` : ''}
      <div class="info-block">
        <div class="info-row"><span>Объект</span><span>${obj?.name}</span></div>
        <div class="info-row"><span>Организация</span><span>${org?.name}</span></div>
        <div class="info-row"><span>Ответственный</span><span>${escapeHtml(wizard.responsible || org?.executor || '—')}${!trainingWizard && responsibleEmail ? `<br><span class="info-row-sub">${escapeHtml(responsibleEmail)}</span>` : ''}</span></div>
        <div class="info-row"><span>Категория</span><span>${cat?.name}</span></div>
        <div class="info-row"><span>Нормы</span><span>${buildNormRefs().join('; ') || '—'}</span></div>
        <div class="info-row"><span>Критичность</span><span>${sev?.label}</span></div>
        <div class="info-row"><span>Срок</span><span>${formatDate(deadline.toISOString())}</span></div>
        <div class="info-row"><span>Фото</span><span>${wizard.media.length} шт.</span></div>
      </div>
      ${
        trainingWizard
          ? ''
          : `<div class="info-block">
        <h3>Уведомления</h3>
        <label class="notify-check"><input type="checkbox" id="w-notify-push" ${wizard.notifyPush ? 'checked' : ''}> 📱 Push</label>
        <label class="notify-check"><input type="checkbox" id="w-notify-email" ${wizard.notifyEmail ? 'checked' : ''}> 📧 Email</label>
        <label class="notify-check"><input type="checkbox" id="w-notify-telegram" ${wizard.notifyTelegram ? 'checked' : ''}> 💬 Telegram</label>
        <div id="w-email-fields" style="margin-top:12px;${wizard.notifyEmail ? '' : 'display:none'}">
          <p style="font-size:0.85rem;color:var(--muted);margin-bottom:8px">Кому отправить (можно несколько):</p>
          <div id="w-email-recipients" class="email-recipients-list">${recipientRows}</div>
          <div class="form-group" style="margin-top:10px">
            <label>Добавить email</label>
            <div style="display:flex;gap:8px">
              <input type="email" id="w-email-extra" placeholder="email@company.ru" style="flex:1">
              <button type="button" class="btn-secondary" id="w-email-add" style="width:auto;padding:10px 14px">+</button>
            </div>
          </div>
        </div>
      </div>`
      }`;

    if (!trainingWizard) {
      $('#w-notify-email')?.addEventListener('change', (e) => {
        wizard.notifyEmail = e.target.checked;
        $('#w-email-fields').style.display = wizard.notifyEmail ? 'block' : 'none';
        updateWizardSubmitLabel();
      });
      $('#w-notify-push')?.addEventListener('change', (e) => {
        wizard.notifyPush = e.target.checked;
      });
      $('#w-notify-telegram')?.addEventListener('change', (e) => {
        wizard.notifyTelegram = e.target.checked;
      });
      $('#w-email-recipients')?.querySelectorAll('[data-email-to]').forEach((inp) => {
        inp.onchange = () => {
          const e = inp.dataset.emailTo?.trim().toLowerCase();
          if (e) wizard.emailRecipients[e] = inp.checked;
        };
      });
      $('#w-email-add')?.addEventListener('click', () => {
        const extra = $('#w-email-extra')?.value.trim();
        if (!extra?.includes('@')) {
          toast('Введите корректный email');
          return;
        }
        wizard.emailRecipients[extra.toLowerCase()] = true;
        $('#w-email-extra').value = '';
        toast(`Добавлен: ${extra}`);
        renderWizard();
      });
    }
    updateWizardSubmitLabel();
  }
  renderWizardGuide();
}

function renderWizardGuide() {
  const el = $('#wizard-guide');
  if (!el) return;
  const text = WIZARD_GUIDE[wizardStep];
  if (!text) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML = `
    <p class="wizard-guide-step">Подсказка · шаг ${wizardStep + 1} из ${WIZARD_STEPS}</p>
    <p class="wizard-guide-text">${escapeHtml(text)}</p>`;
}

function updateWizardSubmitLabel() {
  const next = $('#wizard-next');
  if (!next || wizardStep !== 6) return;
  next.textContent = wizard.notifyEmail ? 'Создать и отправить Email' : 'Создать';
}

function memberDisplayEmail(m) {
  return String(m?.email || m?.contactEmail || m?.notifyEmail || '').trim();
}

function formatWizardEmailRecipientRow(o) {
  const title =
    o.kind === 'org'
      ? 'Организация'
      : o.kind === 'self'
        ? `Вы: ${o.name}`
        : o.kind === 'extra'
          ? 'Добавлен'
          : o.isResponsible
            ? `Ответственный: ${o.name}`
            : o.name;
  const emailLine = o.kind === 'extra' || o.kind === 'org' ? o.email : o.email;
  return `
    <label class="notify-row email-recipient-row${o.isResponsible ? ' email-recipient-row--responsible' : ''}">
      <span class="email-recipient-text">
        <span class="email-recipient-title">${escapeHtml(title)}</span>
        <span class="email-recipient-email">${escapeHtml(emailLine)}</span>
      </span>
      <input type="checkbox" data-email-to="${escapeHtml(o.email)}" ${wizard.emailRecipients[o.email] ? 'checked' : ''}>
    </label>`;
}

function buildWizardEmailRecipientOptions(org) {
  const opts = [];
  const seen = new Set();
  const add = (email, name, extra = {}) => {
    const e = String(email || '').trim().toLowerCase();
    if (!e.includes('@') || seen.has(e) || BLOCKED_NOTIFY_EMAILS.has(e)) return;
    seen.add(e);
    opts.push({ email: e, name: name || e, ...extra });
  };
  const members = wizard.contractorMembers || [];
  const responsibleId = wizard.responsibleUserId;
  const sortedMembers = [...members].sort((a, b) => {
    if (a.id === responsibleId) return -1;
    if (b.id === responsibleId) return 1;
    if (a.isHead && !b.isHead) return -1;
    if (b.isHead && !a.isHead) return 1;
    return 0;
  });
  sortedMembers.forEach((m) => {
    add(memberDisplayEmail(m), m.name, {
      isResponsible: m.id === responsibleId,
      isHead: !!m.isHead,
    });
  });
  if (store.user?.email) {
    add(store.user.email, store.user.name || store.user.email, { kind: 'self' });
  }
  if (org?.email) {
    add(org.email, org.name || 'Организация', { kind: 'org' });
  }
  Object.keys(wizard.emailRecipients || {}).forEach((email) => {
    add(email, email, { kind: 'extra' });
  });
  return opts;
}

async function refreshWizardResponsibleSelect() {
  const wrap = $('#w-responsible-wrap');
  const hint = $('#w-responsible-hint');
  if (!wrap) return;
  wrap.innerHTML = '<p class="wizard-hint">Загрузка…</p>';
  let members = [];
  if (apiMode && wizard.contractorId) {
    try {
      const data = await VictoryAPI.getContractorMembers(wizard.contractorId);
      members = data.members || [];
    } catch (_) {
      members = [];
    }
  } else {
    const org = getContractor(wizard.contractorId);
    if (org?.executor) {
      members = [{ id: '', name: org.executor, email: org.email || '', notifyEmail: org.email || '' }];
    }
  }
  wizard.contractorMembers = members;
  if (!members.length) {
    wrap.innerHTML =
      '<p class="wizard-hint">Нет сотрудников. Добавьте пользователей в админ-панели → Организации.</p>';
    wizard.responsibleUserId = '';
    wizard.responsible = getContractor(wizard.contractorId)?.executor || '';
    if (hint) {
      hint.textContent = 'Список обновляется автоматически после добавления сотрудника.';
    }
    return;
  }

  const objectId = wizard.objectId || '';
  members = [...members].sort((a, b) => {
    if (a.isHead && !b.isHead) return -1;
    if (b.isHead && !a.isHead) return 1;
    const aOnObj =
      !objectId || !a.objects?.length || a.objects.some((o) => String(o.id) === String(objectId));
    const bOnObj =
      !objectId || !b.objects?.length || b.objects.some((o) => String(o.id) === String(objectId));
    if (aOnObj !== bOnObj) return aOnObj ? -1 : 1;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
  });

  if (!wizard.responsibleUserId || !members.find((m) => String(m.id) === String(wizard.responsibleUserId))) {
    const head = members.find((m) => m.isHead);
    wizard.responsibleUserId = head?.id ?? members[0].id;
  }
  const current = members.find((m) => String(m.id) === String(wizard.responsibleUserId)) || members[0];
  wizard.responsible = current?.name || '';

  wrap.innerHTML = `
    <div class="picker-list picker-list--scroll" id="w-responsible-list">
      ${members
        .map((m) => {
          const em = memberDisplayEmail(m);
          const selected = String(m.id) === String(wizard.responsibleUserId);
          const memberKey = String(m.id || em || m.name || '');
          const onObject =
            !objectId || !m.objects?.length || m.objects.some((o) => String(o.id) === String(objectId));
          const sub = [em, !onObject ? 'другой объект' : ''].filter(Boolean).join(' · ');
          return `<button type="button" class="picker-item ${selected ? 'selected' : ''}" data-id="${escapeHtml(memberKey)}">
            <span>
              <span class="picker-item-title">${escapeHtml(m.name)}${m.isHead ? ' · начальник' : ''}</span>
              ${sub ? `<span class="picker-item-sub">${escapeHtml(sub)}</span>` : ''}
            </span>
          </button>`;
        })
        .join('')}
    </div>`;

  wrap.querySelectorAll('#w-responsible-list .picker-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.id || '';
      const picked =
        members.find((m) => String(m.id) === key) ||
        members.find((m) => memberDisplayEmail(m) === key) ||
        members.find((m) => String(m.name) === key);
      if (!picked) return;
      wizard.responsibleUserId = picked.id;
      wizard.responsible = picked.name || '';
      wrap.querySelectorAll('#w-responsible-list .picker-item').forEach((b) => {
        b.classList.toggle('selected', b === btn);
      });
      const em = memberDisplayEmail(picked).toLowerCase();
      if (em.includes('@')) {
        wizard.emailRecipients = wizard.emailRecipients || {};
        wizard.emailRecipients[em] = true;
      }
    });
  });
  if (hint) {
    hint.textContent =
      members.length > 1
        ? 'Выберите ответственного из списка. Первым указан начальник организации.'
        : 'Ответственный выбран автоматически.';
  }
}

function syncWizardEmailsFromDom() {
  wizard.emailRecipients = wizard.emailRecipients || {};
  $('#w-email-recipients')?.querySelectorAll('[data-email-to]').forEach((inp) => {
    const e = inp.dataset.emailTo?.trim().toLowerCase();
    if (e) wizard.emailRecipients[e] = inp.checked;
  });
  const extra = $('#w-email-extra')?.value.trim().toLowerCase();
  if (extra?.includes('@')) {
    wizard.emailRecipients[extra] = true;
  }
}

function initWizardEmailRecipients(org) {
  if (!wizard.emailRecipients) wizard.emailRecipients = {};
  const responsible = (wizard.contractorMembers || []).find((m) => m.id === wizard.responsibleUserId);
  const respEmail = memberDisplayEmail(responsible).toLowerCase();
  if (respEmail.includes('@')) {
    wizard.emailRecipients[respEmail] = true;
  }
  const opts = buildWizardEmailRecipientOptions(org);
  opts.forEach((o) => {
    const key = o.email.toLowerCase();
    if (wizard.emailRecipients[key] === undefined) {
      wizard.emailRecipients[key] = true;
    }
  });
}

function getWizardSelectedEmails() {
  syncWizardEmailsFromDom();
  if (!wizard.emailRecipients) return [];
  const selected = [
    ...new Set(
      Object.entries(wizard.emailRecipients)
        .filter(([, on]) => on)
        .map(([email]) => email.trim().toLowerCase())
        .filter((e) => !BLOCKED_NOTIFY_EMAILS.has(e))
    ),
  ];
  return selected.length ? filterNotifyRecipients(selected) : [];
}

function updateWizardDeadlinePreview() {
  const el = $('#deadline-preview');
  if (el && wizard.severity) {
    el.textContent = `Срок устранения: ${formatDate(calcDeadline(wizard.severity).toISOString())}`;
  }
}

async function onWizardPhotos(e) {
  const input = e.target;
  const files = input.files ? [...input.files] : [];
  if (!files.length) {
    toast('Фото не выбрано');
    return;
  }
  const room = 10 - wizard.media.length;
  const slice = files.slice(0, room);
  let done = 0;
  for (const file of slice) {
    if (!file.type || !file.type.startsWith('image/')) continue;
    try {
      const dataUrl = await compressImageFile(file);
      if (dataUrl) wizard.media.push(dataUrl);
    } catch (err) {
      toast(err.message || 'Ошибка фото');
    }
    done += 1;
  }
  if (wizard.media.length > 10) wizard.media = wizard.media.slice(0, 10);
  input.value = '';
  renderWizard();
  if (wizard.media.length) toast(`Фото: ${wizard.media.length}`);
}

function getGeoLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      wizard.locationGps = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      };
    },
    () => {}
  );
}

function wizardGoBack() {
  if (wizardStep > 0) {
    goToWizardStep(wizardStep - 1).catch((e) => toast(e.message));
  } else {
    showScreen('list');
  }
}

async function goToWizardStep(step) {
  if (step === 1 && apiMode) {
    try {
      await refreshDirectories();
    } catch (_) {}
  }
  wizardStep = step;
  renderWizard();
}

$('#wizard-back')?.addEventListener('click', wizardGoBack);
$('#wizard-back-bottom')?.addEventListener('click', wizardGoBack);

$('#wizard-next')?.addEventListener('click', () => {
  const nextBtn = $('#wizard-next');
  withActionGuard(
    'wizard-next',
    async () => {
  if (!validateWizardStep()) return;
  if (wizardStep < WIZARD_STEPS - 1) {
        await goToWizardStep(wizardStep + 1);
  } else {
        await createViolation();
      }
    },
    {
      busyEl: nextBtn,
      busyLabel: wizardStep === WIZARD_STEPS - 1 ? 'Создание…' : '',
    }
  ).catch((e) => toast(e.message));
});

function buildNormRefs() {
  return (wizard.normEntries || [])
    .map((e) => {
      const doc = String(e.doc || '').trim();
      const clause = String(e.clause || '').trim();
      if (!doc && !clause) return '';
      if (doc && clause) return `${doc}, ${clause}`;
      return doc || clause;
    })
    .filter(Boolean);
}

function validateWizardStep() {
  if (wizardStep === 1 && wizard.contractorMembers?.length && !wizard.responsibleUserId) {
    toast('Выберите ответственного');
    return false;
  }
  if (wizardStep === 2 && !wizard.categoryId) {
    toast('Выберите категорию');
    return false;
  }
  if (wizardStep === 2 && wizard.categoryId === 'other' && !(wizard.categoryOther || '').trim()) {
    toast('Укажите название категории');
    return false;
  }
  if (wizardStep === 3 && wizard.media.length < 1) {
    toast('Добавьте хотя бы одно фото');
    return false;
  }
  if (wizardStep === 4 && !(wizard.description || '').trim()) {
    toast('Введите описание');
    return false;
  }
  if (wizardStep === 5) {
    const norms = buildNormRefs();
    if (!norms.length) {
      toast('Укажите документ и пункт нарушения');
    return false;
  }
    const incomplete = (wizard.normEntries || []).some((e) => {
      const doc = String(e.doc || '').trim();
      const clause = String(e.clause || '').trim();
      return (doc && !clause) || (!doc && clause);
    });
    if (incomplete) {
      toast('Заполните и документ, и пункт для каждой строки');
      return false;
    }
  }
  if (wizardStep === 6 && !wizard.severity) {
    toast('Выберите критичность нарушения');
    return false;
  }
  if (wizardStep === 7 && wizard.notifyEmail) {
    syncWizardEmailsFromDom();
    if (!USE_TEMP_EMAIL_RECIPIENT && !getWizardSelectedEmails().length) {
      toast('Выберите хотя бы один email или добавьте через +');
      return false;
    }
  }
  return true;
}

async function trySyncViolationToServer(payload) {
  let email = '';
  let pass = '';
  try {
    email = sessionStorage.getItem('vc_sync_email') || '';
    pass = sessionStorage.getItem('vc_sync_pass') || '';
  } catch (_) {}
  setupServerConfigUi();
  if (!email || !pass) return null;
  try {
    await VictoryAPI.check();
    if (!VictoryAPI.enabled) return null;
    const login = await VictoryAPI.login(email, pass);
    VictoryAPI.setToken(login.token);
    return await VictoryAPI.createViolation(payload);
  } catch (e) {
    console.warn('sync to server:', e.message);
    return null;
  }
}

function addOfflineNotifications(v, wizardState) {
  const obj = getObject(v.objectId);
  const org = getContractor(v.contractorId);
  const head = `⚠️ Новое нарушение №${v.number}`;
  const base = {
    violationId: v.id,
    isRead: false,
    read: false,
    at: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  if (wizardState.notifyPush !== false) {
    store.notifications.unshift({
      ...base,
      id: 'n' + Date.now() + '-p',
      channel: 'push',
      type: 'violation_new',
      title: head,
      message: `${obj?.name} • ${org?.name}`,
      body: `${head}\n${obj?.name} • ${org?.name}\nСрок: ${formatDate(v.deadline)}`,
      actionLabel: 'Открыть',
    });
  }
  if (wizardState.notifyEmail) {
    const emails = getWizardSelectedEmails();
    store.notifications.unshift({
      ...base,
      id: 'n' + Date.now() + '-e',
      channel: 'email',
      type: 'violation_new',
      title: '📧 Email',
      message: emails.length ? `Кому: ${emails.join(', ')}` : 'Получатели не выбраны',
    });
  }
  if (wizardState.notifyTelegram) {
    store.notifications.unshift({
      ...base,
      id: 'n' + Date.now() + '-t',
      channel: 'telegram',
      type: 'violation_new',
      title: '💬 Telegram',
      message: `Нарушение ${v.number}`,
    });
  }
}

async function createViolation() {
  return withActionGuard('create-violation', async () => {
  ensureStoreArrays(store);
  const org = getContractor(wizard.contractorId);
  const desc = wizard.description.trim();
  const trainingCreate = isTrainingWizardActive();
  const payload = {
    objectId: wizard.objectId,
    contractorId: wizard.contractorId,
    categoryId: wizard.categoryId,
    categoryOther: wizard.categoryId === 'other' ? (wizard.categoryOther || '').trim() : '',
    severity: wizard.severity,
    description:
      trainingCreate && !desc.includes('[TRAINING_PRACTICE]')
        ? `[TRAINING_PRACTICE] ${desc}`
        : desc,
    responsible: wizard.responsible || org?.executor || '',
    responsibleUserId: wizard.responsibleUserId || null,
    media: wizard.media,
    locationGps: wizard.locationGps || null,
    normRefs: buildNormRefs(),
    sendEmail: trainingCreate ? false : !!wizard.notifyEmail,
    notifyEmails: trainingCreate ? [] : getWizardSelectedEmails(),
    sendTelegram: trainingCreate ? false : !!wizard.notifyTelegram,
    notifyTelegram: trainingCreate ? false : !!wizard.notifyTelegram,
  };

  let v;
  let emailResult = null;
  let telegramResult = null;
  if (apiMode) {
    const data = await VictoryAPI.createViolation(payload);
    emailResult = data.email;
    telegramResult = data.telegram;
    if (!data?.violation) throw new Error('Ошибка ответа сервера');
    await syncViolations({ full: true });
    v = store.violations.find((x) => x.id === data.violation.id) || data.violation;
    if (!store.violations.some((x) => x.id === v.id)) store.violations.unshift(v);
    await loadNotifications();
  } else {
    const obj = getObject(wizard.objectId);
    const number = nextViolationNumber(obj.code);
    const deadline = calcDeadline(wizard.severity);
    const id = 'v' + Date.now();
    v = {
      id,
      number,
      ...payload,
      status: 'new',
      deadline: deadline.toISOString(),
      createdAt: new Date().toISOString(),
      responsible: wizard.responsible || getContractor(wizard.contractorId)?.executor?.trim() || '—',
      responsibleUserId: wizard.responsibleUserId || null,
      createdByUserId: store.user?.id || null,
      createdByName: store.user?.name || 'Аудитор',
      history: [{ at: new Date().toISOString(), text: 'Нарушение создано', by: store.user?.name || 'Аудитор' }],
      comments: [],
    };
    ensureStoreArrays(store);
    store.violations.unshift(v);
    if (!trainingCreate) addOfflineNotifications(v, wizard);

    const serverData = await trySyncViolationToServer(payload);
    if (serverData?.violation) {
      emailResult = serverData.email;
      telegramResult = serverData.telegram;
      toast('Сервер доступен — уведомления отправлены');
    }
  }
  try {
    persist();
  } catch (e) {
    toast('Ошибка сохранения: ' + (e.message || 'память телефона'));
    return;
  }
  toast(
    trainingCreate
      ? `Учебный акт ${v?.number || ''} создан. Никому ничего не отправлено.`
      : `Нарушение ${v?.number || ''} создано`
  );
  window.VCOnboarding?.handleEvent?.('violation-created', { id: v.id, violation: v });

  if (trainingCreate) {
    showScreen('detail');
    detailId = v.id;
    await renderDetail(v.id);
    return;
  }

  if (wizard.notifyEmail && emailResult) {
    const msg = emailResult.message || '';
    const actHint = emailResult.hasAct ? '' : ' Акт не прикреплён — проверьте шаблон на сервере.';
    const failed = []
      .concat(emailResult.failedAct || [])
      .concat(emailResult.failedNotify || [])
      .concat(emailResult.failed || []);
    const failedText = failed.length
      ? ` Не доставлено: ${failed
          .map((s) => String(s).split(':')[0].trim())
          .filter(Boolean)
          .slice(0, 3)
          .join(', ')}${failed.length > 3 ? '…' : ''}.`
      : '';
    toast(
      (msg.length > 120 ? msg.slice(0, 120) + '…' : msg || (emailResult.sent ? 'Письма отправлены' : 'Письма не отправлены')) +
        actHint +
        failedText
    );
    if (emailResult.failed?.length) console.warn('Email failed:', emailResult.failed);
  } else if (wizard.notifyTelegram && telegramResult) {
    toast(telegramResult.sent ? telegramResult.message || 'Telegram отправлен' : telegramResult.message || 'Telegram не отправлен');
  } else if (wizard.notifyTelegram && !telegramResult) {
    toast('Telegram: подключите бота в Профиль → Уведомления');
  } else if (wizard.notifyEmail && apiMode) {
    toast('Email: запустите setup-free.ps1 (Mail.ru) или подключите Gmail');
  } else if (!apiMode && (wizard.notifyEmail || wizard.notifyTelegram)) {
    toast(
      'Push — в ленте профиля. Email и Telegram — через сервер.'
    );
  }

  wizardStep = 0;
  showScreen('list');
  openDetail(v.id);
  });
}

function getDefaultEmailRecipients(v) {
  const org = v ? getContractor(v.contractorId) : null;
  return filterNotifyRecipients([store.notifyEmail, org?.email].filter(Boolean));
}

async function sendViolationEmail(v, recipients, event = 'created') {
  return withActionGuard(
    actionKey(['send-email', v?.id, event]),
    async () => {
      const emails = USE_TEMP_EMAIL_RECIPIENT
        ? [TEMP_EMAIL_RECIPIENT]
        : Array.isArray(recipients)
    ? recipients
    : getDefaultEmailRecipients(v);
  if (!emails.length) {
    toast('Нет получателей');
    return;
  }
  if (!apiMode) {
    toast('Письма только при подключении к серверу на ПК');
    return;
  }
  const result = await VictoryAPI.sendViolationEmail(v.id, { notifyEmails: emails, event });
      toast(
        result.message ||
          (result.sent
            ? USE_TEMP_EMAIL_RECIPIENT
              ? `Отправлено: уведомление + акт на ${TEMP_EMAIL_RECIPIENT}`
              : `Отправлено: ${emails.join(', ')}${result.hasAct ? ' (2 письма)' : ''}`
            : 'Не отправлено — проверьте почту на сервере')
      );
    }
  );
}

/* ——— Detail ——— */
function buildViolationShareText(v) {
  const obj = getObject(v.objectId);
  const org = getContractor(v.contractorId);
  const cat = getCategory(v.categoryId, v);
  return [
    `Нарушение ${v.number}`,
    `Объект: ${obj?.name || '—'}`,
    `Организация: ${org?.name || '—'}`,
    `Категория: ${cat?.name || '—'}`,
    `Описание: ${v.description}`,
    `Срок: ${formatDate(v.deadline)}`,
    `Ответственный: ${v.responsible || '—'}`,
    `Статус: ${STATUS_LABELS[v.status] || v.status}`,
  ].join('\n');
}

async function loadNotifications() {
  if (!apiMode || !store.user) return;
  try {
    const data = await VictoryAPI.getNotifications();
    store.notifications = Array.isArray(data.notifications) ? data.notifications : [];
    if (window.VCPushNotify) {
      VCPushNotify.processNotifications(store.notifications, store.user.id);
    }
  } catch (_) {
    ensureStoreArrays(store);
  }
}

function renderNotificationsFeed() {
  const el = $('#notifications-feed');
  if (!el) return;
  ensureStoreArrays(store);
  const list = store.notifications.slice(0, 25);
  if (!list.length) {
    el.innerHTML = '<p style="color:var(--muted);font-size:0.85rem">Нет уведомлений</p>';
    return;
  }
  el.innerHTML = list
    .map((n) => {
      const unread = !(n.isRead || n.read);
      const isEmail = n.channel === 'email';
      const isTelegram = n.channel === 'telegram';
      const channelLabel = isEmail ? 'Email' : isTelegram ? 'Telegram' : 'Push';
      const preview = isTelegram
        ? n.message || n.title
        : isEmail
        ? n.message || (n.body || '').split('\n').slice(0, 3).join(' ')
          : n.title && n.body && n.body.startsWith(n.title)
            ? n.body
        : n.body || n.message || n.title;
      const tgBody =
        isTelegram && n.body
          ? `<pre class="tg-preview">${escapeHtml(String(n.body).slice(0, 280))}</pre>`
          : '';
      const statusCls =
        isTelegram && n.deliveryStatus === 'failed' ? ' tg-failed' : isTelegram ? ' tg-sent' : '';
      return `
      <article class="push-card ${unread ? 'unread' : ''} ${isEmail ? 'channel-email' : ''}${statusCls}"
        data-vid="${n.violationId || ''}" data-id="${n.id}">
        ${isEmail ? `<div class="email-subject">📧 ${escapeHtml(n.subject || n.title || '')}</div>` : ''}
        ${isTelegram ? `<div class="email-subject">${escapeHtml(n.title || '💬 Telegram')}</div>` : ''}
        <div>${escapeHtml(preview)}</div>
        ${tgBody}
        <div class="push-meta">
          <span>${channelLabel} · ${formatDate(n.createdAt || n.at)}</span>
          ${n.actionLabel ? `<span class="push-action">[${escapeHtml(n.actionLabel)}]</span>` : ''}
        </div>
      </article>`;
    })
    .join('');

  el.querySelectorAll('.push-card').forEach((card) => {
    card.onclick = () => {
      const n = store.notifications.find((x) => x.id === card.dataset.id);
      if (n) {
        n.isRead = true;
        n.read = true;
      }
      if (card.dataset.vid) openDetail(card.dataset.vid);
      renderNotificationsFeed();
      $('.badge-dot').classList.toggle(
        'has-notify',
        store.notifications.some((x) => !(x.isRead || x.read))
      );
    };
  });
}

async function shareViolation(v, channel) {
  if (isOnboardingTicket(v)) {
    toast('Учебный тикет — отправка отключена');
    return;
  }
  if (channel === 'email') {
    // Кнопка «Отправить акт» — отправляет акт-предписание по нарушению.
    await sendViolationEmail(v, getDefaultEmailRecipients(v), 'created');
    return;
  }
  const text = buildViolationShareText(v);
  if (channel === 'tg') {
    window.open(`https://t.me/share/url?text=${encodeURIComponent(text)}`, '_blank');
    toast('Открыт Telegram');
  } else if (channel === 'email') {
    const subject = encodeURIComponent(`[Visural Audit] Нарушение ${v.number}`);
    const body = encodeURIComponent(text);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }
}

function openDetail(id) {
  detailId = id;
  showScreen('detail');
  window.VCOnboarding?.handleEvent?.('detail-opened', { id });
}

async function renderDetail(id) {
  let v = store.violations.find((x) => x.id === id);
  if (apiMode) {
    try {
      const data = await VictoryAPI.getViolation(id);
      v = data.violation;
      const i = store.violations.findIndex((x) => x.id === id);
      if (i >= 0) store.violations[i] = v;
      else store.violations.push(v);
    } catch (_) {}
  }
  if (!v) return;
  const training = isOnboardingTicket(v);
  const banner = $('#detail-training-banner');
  if (banner) {
    if (training) {
      banner.innerHTML = TRAINING_BANNER_HTML;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
      banner.innerHTML = '';
    }
  }

  const obj = getObject(v.objectId);
  const org = getContractor(v.contractorId);
  const cat = getCategory(v.categoryId, v);
  const sev = SEVERITY.find((s) => s.id === v.severity);

  $('#detail-title').textContent = v.number;
  $('#detail-status').textContent = STATUS_LABELS[v.status] || v.status;
  $('#detail-status').className = 'status-pill ' + v.status;

  const gallery = $('#detail-gallery');
  const fixation = Array.isArray(v.media) ? v.media.filter(Boolean) : [];
  const reportPhotos = [
    ...(Array.isArray(v.reportMedia) ? v.reportMedia : []),
    ...((v.comments || [])
      .filter((c) => c?.type === 'report')
      .flatMap((c) => c.media || [])),
  ].filter(Boolean);
  const reportUnique = [...new Set(reportPhotos.map(String))];
  const parts = [];
  if (fixation.length) {
    parts.push(
      `<div class="detail-gallery-section"><div class="detail-gallery-label">Фиксация</div><div class="detail-gallery-row">${fixation
        .map((m) => `<img src="${mediaUrl(m)}" alt="">`)
        .join('')}</div></div>`
    );
  }
  if (reportUnique.length) {
    parts.push(
      `<div class="detail-gallery-section"><div class="detail-gallery-label">Фото отчёта об устранении</div><div class="detail-gallery-row">${reportUnique
        .map((m) => `<img src="${mediaUrl(m)}" alt="">`)
        .join('')}</div></div>`
    );
  }
  gallery.innerHTML = parts.length
    ? parts.join('')
    : '<p style="color:var(--muted)">Нет фото</p>';

  $('#detail-info').innerHTML = `
    <div class="info-row"><span>Объект</span><span>${obj?.name}</span></div>
    <div class="info-row"><span>Организация</span><span>${org?.name}</span></div>
    <div class="info-row"><span>Категория</span><span>${cat?.name}</span></div>
    <div class="info-row"><span>Критичность</span><span>${sev?.label}</span></div>
    <div class="info-row"><span>Описание</span><span>${escapeHtml(training ? cleanTrainingDescription(v.description) : v.description)}</span></div>
    <div class="info-row"><span>Срок</span><span>${formatDate(v.deadline)}</span></div>
    <div class="info-row"><span>Ответственный</span><span>${v.responsible}</span></div>
    <div class="info-row"><span>Нормы</span><span>${(v.normRefs || []).join(', ')}</span></div>
    ${v.locationGps ? `<div class="info-row"><span>GPS</span><span>${v.locationGps.lat.toFixed(5)}, ${v.locationGps.lng.toFixed(5)}</span></div>` : ''}
  `;

  $('#detail-timeline').innerHTML = (v.history || [])
    .map(
      (h) => `<div class="timeline-item"><time>${formatDate(h.at)} · ${h.by}</time><div>${escapeHtml(h.text)}</div></div>`
    )
    .join('');

  $('#detail-comments').innerHTML = (v.comments || []).length
    ? v.comments
        .map((c) => {
          const imgs = (c.media || [])
            .map((m) => `<img class="comment-thumb" src="${mediaUrl(m)}" alt="">`)
            .join('');
          const mediaBlock = imgs ? `<div class="comment-media">${imgs}</div>` : '';
          const label =
            c.type === 'report'
              ? '📋 Отчёт · '
              : c.type === 'reject'
                ? '⛔ Отчёт отклонён · '
                : '';
          return `<div class="comment${c.type === 'reject' ? ' comment-reject' : ''}"><div class="comment-meta">${label}${formatDate(c.at)} · ${c.by}</div>${escapeHtml(c.text)}${mediaBlock}</div>`;
        })
        .join('')
    : '<p style="color:var(--muted);font-size:0.9rem">Нет комментариев</p>';

  $('#detail-actions').innerHTML = buildDetailActions(v);
  initDetailActions();
}

function canDeleteViolation(v) {
  const u = store.user;
  if (!u) return false;
  const role = String(u.role || '').toLowerCase();
  if (role === 'contractor') return false;
  if (isOnboardingTicket(v) && role !== 'admin') return false;
  if (role === 'admin') return true;
  return !!(v.createdByUserId && u.id && v.createdByUserId === u.id);
}

function buildDetailActions(v) {
  const p = userPerms();
  const parts = [];
  if (p.editStatus && v.status === 'verification') {
    parts.push(
      '<p class="verification-hint" style="color:var(--accent);font-size:0.88rem;padding:8px 0;line-height:1.4">📋 Получен отчёт об устранении — проверьте комментарии ниже и выберите новый статус</p>'
    );
  }
  if (p.editStatus) {
    parts.push('<button type="button" data-action="status">Изменить статус</button>');
  }
  if (p.comment) {
    parts.push('<button type="button" data-action="comment">Комментарий</button>');
  }
  if (p.report && v.status !== 'resolved' && v.status !== 'verification') {
    const lastReject = [...(v.comments || [])].reverse().find((c) => c.type === 'reject');
    if (lastReject?.text) {
      parts.push(
        `<p class="verification-hint" style="color:#c45c5c;font-size:0.88rem;padding:8px 0;line-height:1.4">⛔ Предыдущий отчёт отклонён: ${escapeHtml(lastReject.text)}</p>`
      );
    }
    parts.push('<button type="button" data-action="report" class="primary">Отчёт об устранении</button>');
  } else if (p.report && v.status === 'verification') {
    parts.push('<p style="color:var(--muted);font-size:0.85rem;padding:8px 0">Отчёт отправлен — ожидает проверки</p>');
    if (String(store.user?.role || '').toLowerCase() === 'contractor') {
      parts.push(
        '<button type="button" data-action="append-photos" class="primary">📷 Добавить фото к отчёту</button>'
      );
    }
  }
  if (p.share && !isOnboardingTicket(v)) {
    parts.push('<button type="button" data-action="share-tg">📨 Telegram</button>');
    parts.push('<button type="button" data-action="share-email">Отправить акт</button>');
  }
  if (canDeleteViolation(v)) {
    parts.push('<button type="button" data-action="delete" class="danger">Удалить нарушение</button>');
  }
  if (!parts.length) {
    return '<p style="color:var(--muted);font-size:0.85rem">Доступен только просмотр</p>';
  }
  return parts.join('');
}

let reportSheetState = { media: [], resolve: null };

function renderReportMediaGrid() {
  const grid = $('#report-media-grid');
  if (!grid) return;
  grid.innerHTML = reportSheetState.media
    .map(
      (m, i) =>
        `<div class="media-thumb-wrap"><img class="media-thumb" src="${mediaUrl(m)}" alt=""><button type="button" class="media-del" data-i="${i}" aria-label="Удалить">×</button></div>`
    )
    .join('');
  grid.querySelectorAll('.media-del').forEach((btn) => {
    btn.onclick = () => {
      reportSheetState.media.splice(Number(btn.dataset.i), 1);
      renderReportMediaGrid();
    };
  });
}

function openReportSheet(opts = {}) {
  return new Promise((resolve) => {
    const photosOnly = !!opts.photosOnly;
    reportSheetState = { media: [], resolve, photosOnly };
    const modal = $('#report-modal');
    const textarea = $('#report-text');
    const textWrap = $('#report-text-wrap');
    const title = $('#report-modal-title');
    const hint = $('#report-modal-hint');
    const submit = $('#report-submit');
    const training = isOnboardingTicket(getDetailViolation());
    setTrainingModalNote($('#report-training-note'), training);
    if (title) title.textContent = photosOnly ? 'Дополнительные фото' : 'Отчёт об устранении';
    if (hint) {
      hint.textContent = photosOnly
        ? 'Прикрепите фото, которые забыли добавить к отчёту.'
        : 'Опишите выполненные работы и приложите фото (по желанию).';
    }
    textWrap?.classList.toggle('hidden', photosOnly);
    if (textarea) textarea.value = '';
    if (submit) submit.textContent = photosOnly ? 'Отправить фото' : 'Отправить';
    renderReportMediaGrid();
    modal?.classList.add('open');
    modal?.setAttribute('aria-hidden', 'false');
    window.VCOnboarding?.handleEvent?.('report-sheet-opened');
  });
}

function closeReportSheet(result) {
  const modal = $('#report-modal');
  modal?.classList.remove('open');
  modal?.setAttribute('aria-hidden', 'true');
  if (reportSheetState.resolve) {
    reportSheetState.resolve(result);
    reportSheetState.resolve = null;
  }
}

let commentSheetState = { resolve: null };

function openCommentSheet() {
  return new Promise((resolve) => {
    commentSheetState = { resolve };
    const modal = $('#comment-modal');
    const textarea = $('#comment-text');
    setTrainingModalNote($('#comment-training-note'), isOnboardingTicket(getDetailViolation()));
    if (textarea) textarea.value = '';
    modal?.classList.add('open');
    modal?.setAttribute('aria-hidden', 'false');
    window.VCOnboarding?.handleEvent?.('comment-sheet-opened');
    setTimeout(() => textarea?.focus(), 120);
  });
}

function closeCommentSheet(result) {
  const modal = $('#comment-modal');
  modal?.classList.remove('open');
  modal?.setAttribute('aria-hidden', 'true');
  if (commentSheetState.resolve) {
    commentSheetState.resolve(result);
    commentSheetState.resolve = null;
  }
  if (!result) {
    window.VCOnboarding?.handleEvent?.('comment-skipped');
  }
}

let statusSheetState = { resolve: null, picked: null };

const STATUS_OPTIONS = [
  { id: 'new', label: 'Новое' },
  { id: 'in_progress', label: 'В работе' },
  { id: 'verification', label: 'На проверке' },
  { id: 'resolved', label: 'Устранено' },
  { id: 'overdue', label: 'Просрочено' },
];

function renderStatusPickList(currentStatus) {
  const list = $('#status-pick-list');
  if (!list) return;
  list.innerHTML = STATUS_OPTIONS.map(
    (o) =>
      `<button type="button" class="picker-item ${o.id === currentStatus ? 'selected' : ''}" data-status="${o.id}">
        <span class="picker-item-title">${o.label}</span>
      </button>`
  ).join('');
  list.querySelectorAll('[data-status]').forEach((btn) => {
    btn.addEventListener('click', () => {
      statusSheetState.picked = btn.dataset.status;
      list.querySelectorAll('.picker-item').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });
}

function openStatusSheet(currentStatus) {
  return new Promise((resolve) => {
    statusSheetState = { resolve, picked: currentStatus };
    const modal = $('#status-modal');
    const cur = $('#status-modal-current');
    if (cur) {
      cur.textContent = `Текущий статус: ${STATUS_LABELS[currentStatus] || currentStatus}`;
    }
    renderStatusPickList(currentStatus);
    modal?.classList.add('open');
    modal?.setAttribute('aria-hidden', 'false');
    window.VCOnboarding?.handleEvent?.('status-sheet-opened');
  });
}

function closeStatusSheet(result) {
  const modal = $('#status-modal');
  modal?.classList.remove('open');
  modal?.setAttribute('aria-hidden', 'true');
  if (statusSheetState.resolve) {
    statusSheetState.resolve(result);
    statusSheetState.resolve = null;
  }
}

async function handleDetailAction(violationId, action, btn) {
  const busyLabels = {
    'share-email': 'Отправка…',
    'share-tg': 'Открытие…',
    delete: 'Удаление…',
    report: 'Отправка…',
    status: 'Сохранение…',
    comment: 'Сохранение…',
    'append-photos': 'Загрузка…',
  };
  return withActionGuard(
    actionKey(['detail', violationId, action]),
    async () => {
  ensureStoreArrays(store);
  let v = store.violations.find((x) => x.id === violationId);
  if (!v && apiMode) {
    const data = await VictoryAPI.getViolation(violationId);
    v = data.violation;
  }
  if (!v) return;

  if (action === 'share-tg' || action === 'share-email') {
        await shareViolation(v, action === 'share-tg' ? 'tg' : 'email');
    return;
  }

      if (action === 'delete') {
        if (!canDeleteViolation(v)) {
          toast('Удаление недоступно');
          return;
        }
        if (!confirm(`Удалить нарушение ${v.number || ''}?`)) return;
  if (apiMode) {
          await VictoryAPI.deleteViolation(violationId);
          ensureStoreArrays(store);
          store.violations = store.violations.filter((x) => x.id !== violationId);
          persist();
          showScreen('list');
          renderList();
          toast('Нарушение удалено');
        }
        return;
      }

      if (apiMode) {
        let body = null;
        if (action === 'comment') {
          const text = await openCommentSheet();
          if (!text?.trim()) return;
          body = { action, text: text.trim() };
        } else if (action === 'report') {
          const payload = await openReportSheet();
          if (!payload) return;
          body = { action: 'report', text: payload.text, media: payload.media };
        } else if (action === 'append-photos') {
          const payload = await openReportSheet({ photosOnly: true });
          if (!payload?.media?.length) {
            toast('Выберите хотя бы одно фото');
            return;
          }
          body = { action: 'append-report-media', media: payload.media };
        } else if (action === 'status') {
          const newStatus = await openStatusSheet(v.status);
          if (!newStatus) return;
          body = { status: newStatus };
        }
        if (!body) return;
        const data = await VictoryAPI.patchViolation(violationId, body);
        ensureStoreArrays(store);
        const i = store.violations.findIndex((x) => x.id === violationId);
        if (i >= 0) store.violations[i] = data.violation;
        else if (data.violation) store.violations.unshift(data.violation);
        await renderDetail(violationId);
        if (action === 'report') await loadNotifications();
        renderNotificationsFeed();
        if (action === 'status') renderList();
        if (action === 'report' || action === 'comment' || action === 'status') {
          window.VCOnboarding?.handleEvent?.(`${action}-done`, {
            id: violationId,
            violation: data.violation,
            status: data.violation?.status,
          });
        }
        toast(
          isOnboardingTicket(data.violation)
            ? action === 'report'
              ? 'Отчёт сохранён. Учебный тикет — никуда не отправлено.'
              : action === 'comment'
                ? 'Комментарий сохранён. Учебный тикет — никуда не отправлено.'
                : action === 'append-photos'
                  ? 'Фото добавлены. Учебный тикет — никуда не отправлено.'
                  : 'Обновлено (учебный режим)'
            : action === 'report'
              ? 'Отчёт отправлен на проверку'
              : action === 'append-photos'
                ? 'Фото добавлены к отчёту'
                : 'Обновлено'
        );
        return;
      }

  if (action === 'status') {
        const newStatus = await openStatusSheet(v.status);
        if (!newStatus) return;
        v.status = newStatus;
    v.history.push({
      at: new Date().toISOString(),
      text: `Статус: ${STATUS_LABELS[v.status]}`,
      by: store.user?.name || 'Пользователь',
    });
    persist();
    renderDetail(v.id);
        renderList();
    toast('Статус обновлён');
  } else if (action === 'comment') {
        const text = await openCommentSheet();
    if (!text?.trim()) return;
    v.comments.push({ at: new Date().toISOString(), text: text.trim(), by: store.user?.name || 'Вы' });
    persist();
    renderDetail(v.id);
        window.VCOnboarding?.handleEvent?.('comment-done', {
          id: violationId,
          violation: v,
        });
  } else if (action === 'report') {
        const payload = await openReportSheet();
        if (!payload) return;
    v.status = 'verification';
        const reportMedia = payload.media || [];
        v.comments.push({
          at: new Date().toISOString(),
          text: payload.text,
          by: store.user?.name || 'Пользователь',
          media: reportMedia,
          type: 'report',
        });
    v.history.push({
      at: new Date().toISOString(),
          text: reportMedia.length
            ? `Отчёт об устранении (${reportMedia.length} фото) — на проверке`
            : 'Отчёт об устранении отправлен на проверку',
      by: store.user?.name || 'Пользователь',
    });
        if (reportMedia.length) {
          v.reportMedia = [...(v.reportMedia || []), ...reportMedia];
        }
    persist();
    renderDetail(v.id);
    window.VCOnboarding?.handleEvent?.('report-done', {
      id: violationId,
      violation: v,
      status: v.status,
    });
    toast('Отчёт отправлен на проверку');
  } else if (action === 'append-photos') {
        const payload = await openReportSheet({ photosOnly: true });
        if (!payload?.media?.length) {
          toast('Выберите хотя бы одно фото');
          return;
        }
        const reportMedia = payload.media || [];
        v.comments.push({
          at: new Date().toISOString(),
          text: 'Дополнительные фото к отчёту',
          by: store.user?.name || 'Пользователь',
          media: reportMedia,
          type: 'report',
        });
        v.reportMedia = [...(v.reportMedia || []), ...reportMedia];
        v.history.push({
          at: new Date().toISOString(),
          text: `Добавлены фото к отчёту (${reportMedia.length})`,
          by: store.user?.name || 'Пользователь',
        });
        persist();
        renderDetail(v.id);
        toast('Фото добавлены к отчёту');
      }
    },
    { busyEl: btn, busyLabel: busyLabels[action] || 'Подождите…' }
  );
}

$('#detail-back')?.addEventListener('click', () => showScreen('list'));

/* ——— Analytics ——— */
function renderKpiGrid(total, resolvedPct, overdue, critical) {
  const ic = (n, s) => (window.VCIcons ? VCIcons.svg(n, { size: 22 }) : '');
  return `
    <div class="kpi-card kpi-total">
      <div class="kpi-icon">${ic('devices')}</div>
      <div class="kpi-value">${total}</div>
      <div class="kpi-label">Всего</div>
    </div>
    <div class="kpi-card kpi-resolved">
      <div class="kpi-icon">${ic('check')}</div>
      <div class="kpi-value">${resolvedPct}%</div>
      <div class="kpi-label">Устранено</div>
    </div>
    <div class="kpi-card kpi-overdue">
      <div class="kpi-icon">${ic('clock')}</div>
      <div class="kpi-value">${overdue}</div>
      <div class="kpi-label">Просрочено</div>
    </div>
    <div class="kpi-card kpi-critical">
      <div class="kpi-icon">${ic('alert')}</div>
      <div class="kpi-value">${critical}</div>
      <div class="kpi-label">Критических</div>
    </div>`;
}

function renderCategoryStats(rows, total) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  if (!rows.length) {
    return '<p style="color:var(--muted);font-size:0.9rem">Нет данных</p>';
  }
  return `<div class="cat-stats">${rows
    .map((item) => {
      const pct = total ? Math.round((item.count / max) * 100) : 0;
      const catId = item.id || CATEGORIES.find((c) => c.name === item.name)?.id || 'other';
      const icon = window.VCIcons ? VCIcons.categoryIcon(catId, { size: 20 }) : '';
      return `<div class="cat-stat-row">
        <span class="cat-stat-icon">${icon}</span>
        <div class="cat-stat-body">
          <div class="cat-stat-top">
            <span class="cat-stat-name">${escapeHtml(item.name)}</span>
            <span class="cat-stat-count">${item.count}</span>
          </div>
          <div class="cat-stat-bar"><span style="width:${pct}%"></span></div>
        </div>
      </div>`;
    })
    .join('')}</div>`;
}

async function renderAnalytics() {
  ensureStoreArrays(store);
  if (apiMode) {
    const a = await VictoryAPI.getAnalytics();
    $('#analytics-kpi').innerHTML = renderKpiGrid(a.total, a.resolvedPct, a.overdue, a.critical);
    $('#analytics-cats').innerHTML = renderCategoryStats(a.byCategory, a.total);
    return;
  }

  const all = store.violations;
  const resolved = all.filter((v) => v.status === 'resolved' || v.status === 'verification').length;
  const overdue = all.filter((v) => isOverdue(v) || v.status === 'overdue').length;
  const critical = all.filter((v) => isDeadlineCritical(v)).length;
  const pct = all.length ? Math.round((resolved / all.length) * 100) : 0;

  $('#analytics-kpi').innerHTML = renderKpiGrid(all.length, pct, overdue, critical);

  const byCat = {};
  all.forEach((v) => {
    const cat = getCategory(v.categoryId, v);
    const n = cat?.name || 'Другое';
    if (!byCat[n]) byCat[n] = { name: n, count: 0, id: cat?.id || v.categoryId };
    byCat[n].count += 1;
  });
  const rows = Object.values(byCat).sort((a, b) => b.count - a.count);
  $('#analytics-cats').innerHTML = renderCategoryStats(rows, all.length);
}

/* ——— Notification settings (п. 2.2.3.4–2.2.3.5) ——— */
const DEFAULT_NOTIFY_SETTINGS = {
  push: {
    newViolation: true,
    statusChange: true,
    deadlineNear: true,
    comments: true,
    system: true,
  },
  email: {
    newViolation: true,
    prescriptions: true,
    dailyDigest: true,
    weeklyReport: true,
    marketing: false,
  },
  messenger: { all: true, criticalOnly: false },
  sms: { criticalOnly: true },
  quietHours: { enabled: true, from: '22:00', to: '07:00', criticalOnly: true },
};

const NOTIFY_FIELD_LABELS = {
  push: {
    newViolation: 'Новые нарушения',
    statusChange: 'Изменение статуса',
    deadlineNear: 'Приближение срока',
    comments: 'Комментарии',
    system: 'Системные сообщения',
  },
  email: {
    newViolation: 'Новые нарушения',
    prescriptions: 'Предписания',
    dailyDigest: 'Ежедневная сводка',
    weeklyReport: 'Еженедельный отчёт',
    marketing: 'Маркетинговые рассылки',
  },
  messenger: {
    all: 'Все уведомления',
    criticalOnly: 'Только критические',
  },
  sms: { criticalOnly: 'Только критические' },
};

function mergeNotifySettings(stored) {
  const s = JSON.parse(JSON.stringify(DEFAULT_NOTIFY_SETTINGS));
  if (!stored) return s;
  ['push', 'email', 'messenger', 'sms', 'quietHours'].forEach((k) => {
    if (stored[k] && typeof stored[k] === 'object') Object.assign(s[k], stored[k]);
  });
  return s;
}

async function loadNotificationSettings() {
  if (apiMode) {
    const data = await VictoryAPI.getNotificationSettings();
    store.notifySettings = data.settings;
    store.notifyEmail = data.notifyEmail || '';
    store.smtpConfigured = data.smtpConfigured;
    store.emailProvider = data.emailProvider;
    store.sendToAnyone = data.sendToAnyone;
    store.googleConfigured = data.googleConfigured;
    store.telegramConfigured = data.telegramConfigured;
    store.telegramConnected = data.telegramConnected;
    return;
  }
  try {
    const raw = localStorage.getItem('vc_notify_settings');
    store.notifySettings = mergeNotifySettings(raw ? JSON.parse(raw) : store.notifySettings);
  } catch {
    store.notifySettings = mergeNotifySettings(store.notifySettings);
  }
  store.notifyEmail =
    store.notifyEmail || localStorage.getItem('vc_notify_email') || '';
  if (store.notifyEmail && BLOCKED_NOTIFY_EMAILS.has(String(store.notifyEmail).trim().toLowerCase())) {
    store.notifyEmail = '';
  }
}

async function saveNotificationSettings(patch) {
  store.notifySettings = mergeNotifySettings({ ...store.notifySettings, ...patch });
  if (apiMode) {
    const data = await VictoryAPI.patchNotificationSettings(patch);
    store.notifySettings = data.settings;
  } else {
    localStorage.setItem('vc_notify_settings', JSON.stringify(store.notifySettings));
  }
  persist();
}

function renderNotifySection(title, channel, fields) {
  const settings = store.notifySettings || mergeNotifySettings();
  const rows = Object.entries(fields)
    .map(([key, label]) => {
      const checked = settings[channel]?.[key] ? 'checked' : '';
      return `<label class="notify-row"><span>${label}</span><input type="checkbox" data-channel="${channel}" data-key="${key}" ${checked}></label>`;
    })
    .join('');
  return `<div class="info-block notify-section"><h4>${title}</h4>${rows}</div>`;
}

async function renderNotificationSettingsScreen() {
  await loadNotificationSettings();
  const body = $('#notification-settings-body');
  if (!body) return;
  body.innerHTML =
    renderNotifySection('📱 Push-уведомления', 'push', NOTIFY_FIELD_LABELS.push) +
    renderNotifySection('📧 Email', 'email', NOTIFY_FIELD_LABELS.email) +
    renderNotifySection('💬 Telegram / мессенджер', 'messenger', NOTIFY_FIELD_LABELS.messenger);

  body.querySelectorAll('input[data-channel]').forEach((inp) => {
    const ch = inp.dataset.channel;
    inp.onchange = async () => {
      const key = inp.dataset.key;
      const patch = { [ch]: { [key]: inp.checked } };
      if (ch === 'messenger' && key === 'criticalOnly' && inp.checked) {
        patch.messenger.all = false;
      }
      if (ch === 'messenger' && key === 'all' && inp.checked) {
        patch.messenger.criticalOnly = false;
      }
      try {
        await saveNotificationSettings(patch);
        toast('Сохранено');
        if (ch === 'messenger') await renderNotificationSettingsScreen();
      } catch (e) {
        toast(e.message);
        inp.checked = !inp.checked;
      }
    };
  });
}

/* ——— Profile ——— */
function objectPickerIcon(object) {
  const n = String(object?.name || '').toLowerCase();
  if (n.includes('склад')) return 'load';
  if (n.includes('трц') || n.includes('галере')) return 'org';
  return 'building';
}

function pickerOptionMark(selected) {
  if (selected && window.VCIcons) {
    return `<span class="picker-mark picker-mark-check">${VCIcons.svg('check', { size: 18 })}</span>`;
  }
  return '<span class="picker-mark picker-mark-radio" aria-hidden="true"></span>';
}

function renderObjectPickerStep() {
  wizard.objectId = wizard.objectId || REF_OBJECTS[0]?.id;
  const selected = REF_OBJECTS.find((o) => o.id === wizard.objectId) || REF_OBJECTS[0];
  const chevron = window.VCIcons ? VCIcons.svg('chevron', { size: 18 }) : '▾';
  return `
    <p class="wizard-label">Выберите объект</p>
    <div class="picker-dropdown">
      <button type="button" class="picker-trigger ${wizardObjectOpen ? 'open' : ''}" id="w-object-trigger">
        <span class="picker-icon">${window.VCIcons ? VCIcons.svg('building', { size: 20 }) : ''}</span>
        <span class="picker-trigger-text">${escapeHtml(selected?.name || '—')}</span>
        <span class="picker-chevron">${chevron}</span>
      </button>
      <div class="picker-panel ${wizardObjectOpen ? '' : 'hidden'}" id="w-object-panel">
        ${REF_OBJECTS.map(
          (o) =>
            `<button type="button" class="picker-option ${wizard.objectId === o.id ? 'selected' : ''}" data-id="${o.id}">
              <span class="picker-icon ${wizard.objectId === o.id ? '' : 'is-muted'}">${window.VCIcons ? VCIcons.svg(objectPickerIcon(o), { size: 20 }) : ''}</span>
              <span class="picker-option-text">${escapeHtml(o.name)}</span>
              ${pickerOptionMark(wizard.objectId === o.id)}
            </button>`
        ).join('')}
      </div>
    </div>`;
}

function bindObjectPickerStep() {
  $('#w-object-trigger')?.addEventListener('click', () => {
    wizardObjectOpen = !wizardObjectOpen;
    renderWizard();
  });
  document.querySelectorAll('#w-object-panel .picker-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      wizard.objectId = btn.dataset.id;
      wizardObjectOpen = false;
      renderWizard();
    });
  });
}

function resizeAvatarFile(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width;
      let h = img.height;
      const scale = Math.min(1, maxSize / Math.max(w, h));
      w = Math.round(w * scale);
      h = Math.round(h * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Не удалось прочитать изображение'));
    };
    img.src = url;
  });
}

async function onAvatarSelected(file) {
  if (!file || !apiMode) return;
  if (file.size > 8 * 1024 * 1024) {
    toast('Файл слишком большой (макс. 8 МБ)');
    return;
  }
  try {
    const avatarUrl = await resizeAvatarFile(file, 256, 0.85);
    const { user } = await VictoryAPI.updateProfile({ avatarUrl });
    store.user = user;
    persist();
    updateAvatars();
    toast('Фото профиля обновлено');
      } catch (e) {
    toast(e.message || 'Не удалось загрузить фото');
  }
}

$('#profile-avatar-input')?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) onAvatarSelected(file);
  e.target.value = '';
});

function renderProfile() {
  const u = store.user;
  if (!u) return;
  setProfileNameLines(u);
  const emailEl = $('#profile-email');
  if (emailEl) {
    const email = u.email || '';
    if (email) {
      emailEl.innerHTML = `<a href="mailto:${escapeHtml(email)}" class="profile-email-link">${escapeHtml(email)}</a>`;
    } else {
      emailEl.textContent = '—';
    }
  }
  $('#profile-company').textContent = u.company || '—';
  const jobTitleEl = $('#profile-job-title');
  const jobTitleRow = $('#profile-job-title-row');
  if (jobTitleEl) jobTitleEl.textContent = u.jobTitle || '—';
  if (jobTitleRow) jobTitleRow.classList.toggle('hidden', !u.jobTitle);
  const phoneEl = $('#profile-phone');
  const phoneRow = $('#profile-phone-row');
  if (phoneEl) phoneEl.textContent = u.phone || '—';
  if (phoneRow) phoneRow.classList.toggle('hidden', !u.phone);
  const roles = {
    auditor: 'Аудитор',
    admin: 'Администратор',
    contractor: 'Подрядчик',
    viewer: 'Наблюдатель',
    manager: 'Руководитель',
  };
  $('#profile-role').textContent = store.user.roleLabel || roles[u.role] || u.role;
  applyRoleUI();
  updateAvatars();
  document.querySelectorAll('[data-theme-btn]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.themeBtn === VCTheme.get());
  });
  loadNotifications()
    .then(() => renderNotificationsFeed())
    .catch(() => renderNotificationsFeed());
}

function renderProfileEditForm() {
  const u = store.user;
  if (!u) return;
  const err = $('#profile-edit-error');
  if (err) err.textContent = '';
  const nameEl = $('#profile-edit-name');
  const companyEl = $('#profile-edit-company');
  const jobTitleEl = $('#profile-edit-job-title');
  const phoneEl = $('#profile-edit-phone');
  const emailEl = $('#profile-edit-email');
  if (nameEl) nameEl.value = u.name || '';
  if (companyEl) companyEl.value = u.company || '';
  if (jobTitleEl) jobTitleEl.value = u.jobTitle || '';
  if (phoneEl) phoneEl.value = u.phone || '';
  if (emailEl) emailEl.value = u.email || '';
}

async function saveProfileEdit() {
  if (!apiMode || !store.user) return;
  const nameEl = $('#profile-edit-name');
  const companyEl = $('#profile-edit-company');
  const jobTitleEl = $('#profile-edit-job-title');
  const phoneEl = $('#profile-edit-phone');
  const err = $('#profile-edit-error');
  const btn = $('#profile-edit-save');
  const fullName = nameEl?.value.trim() || '';
  const company = companyEl?.value.trim() || '';
  const jobTitle = jobTitleEl?.value.trim() || '';
  const phone = phoneEl?.value.trim() || '';
  if (!fullName) {
    if (err) err.textContent = 'Укажите ФИО';
    return;
  }
  if (err) err.textContent = '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Сохранение…';
  }
  try {
    const { user } = await VictoryAPI.updateProfile({ fullName, company, phone, jobTitle });
    store.user = user;
    persist();
    updateAvatars();
    toast('Профиль обновлён');
    showScreen('profile');
  } catch (e) {
    if (err) err.textContent = e.message || 'Не удалось сохранить';
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Сохранить';
    }
  }
}

async function refreshDirectories() {
  if (!apiMode) throw new Error('Нет связи с сервером');
  const [objs, cons] = await Promise.all([VictoryAPI.getObjects(), VictoryAPI.getContractors()]);
    setRefs(objs.objects, cons.contractors);
  saveLocalDirectories({ objects: objs.objects, contractors: cons.contractors, syncedAt: Date.now() });
    return { objects: objs.objects, contractors: cons.contractors };
  }

async function refreshLiveData(opts = {}) {
  if (!apiMode || !store.user) return;
  const silent = opts.silent !== false;
  try {
    await refreshDirectories();
    const listActive = $('#screen-list')?.classList.contains('active');
    const wizardActive = $('#screen-wizard')?.classList.contains('active');
    if (listActive) {
      await syncViolations({ full: currentFilter === 'resolved' });
      await renderList();
    }
    if (wizardActive && wizardStep === 1) {
      const contractorHtml = $('#w-contractor-list');
      if (contractorHtml) {
        contractorHtml.innerHTML = REF_CONTRACTORS.map(
          (c) =>
            `<button type="button" class="picker-item ${wizard.contractorId === c.id ? 'selected' : ''}" data-id="${c.id}">
              <span class="picker-icon">${window.VCIcons ? VCIcons.svg('org', { size: 20 }) : ''}</span>
              <span>
                <span class="picker-item-title">${escapeHtml(c.name)}</span>
                ${c.inn || c.executor ? `<span class="picker-item-sub">${c.inn ? 'ИНН ' + escapeHtml(c.inn) : ''}${c.inn && c.executor ? ' · ' : ''}${c.executor ? escapeHtml(c.executor) : ''}</span>` : ''}
              </span>
            </button>`
        ).join('');
        contractorHtml.querySelectorAll('.picker-item').forEach((btn) => {
          btn.onclick = async () => {
            wizard.contractorId = btn.dataset.id;
            wizard.responsibleUserId = null;
            contractorHtml.querySelectorAll('.picker-item').forEach((b) => b.classList.remove('selected'));
            btn.classList.add('selected');
            await refreshWizardResponsibleSelect();
          };
        });
      }
      await refreshWizardResponsibleSelect();
    }
    if ($('#screen-detail')?.classList.contains('active') && detailId) {
      await renderDetail(detailId);
    }
  } catch (e) {
    if (!silent) toast(e.message || 'Не удалось обновить данные');
  }
}

function startLiveDataSync() {
  if (window._vcLiveSyncInited) return;
  window._vcLiveSyncInited = true;
  const tick = () => refreshLiveData({ silent: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && store.user) tick();
  });
  window.addEventListener('focus', tick);
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && store.user) tick();
  });
  setInterval(tick, 45000);
}

async function renderObjectsSettings() {
  const { objects } = await refreshDirectories();
  const el = $('#objects-list');
  if (!objects.length) {
    el.innerHTML = '<p style="color:var(--muted);font-size:0.9rem">Нет объектов</p>';
    return;
  }
  el.innerHTML = objects
    .map(
      (o) => `
    <div class="dir-item" data-id="${o.id}">
      <span class="picker-icon">${window.VCIcons ? VCIcons.svg('building', { size: 20 }) : ''}</span>
      <main>
        <div class="title">${escapeHtml(o.name)}</div>
        <div class="sub mono">${escapeHtml(o.code)}${o.address ? ' · ' + escapeHtml(o.address) : ''}</div>
      </main>
      <button type="button" class="btn-delete" data-delete-object="${o.id}" aria-label="Удалить">×</button>
    </div>`
    )
    .join('');
  el.querySelectorAll('[data-delete-object]').forEach((btn) => {
    btn.onclick = () => deleteObject(btn.dataset.deleteObject);
  });
}

let editingContractorId = null;

function resetContractorForm() {
  editingContractorId = null;
  $('#new-contractor-name').value = '';
  $('#new-contractor-inn').value = '';
  $('#new-contractor-executor').value = '';
  if ($('#new-contractor-email')) $('#new-contractor-email').value = '';
  const btn = $('#btn-add-contractor');
  if (btn) btn.textContent = 'Добавить';
  const title = $('#contractor-form-title');
  if (title) title.textContent = 'Добавить организацию';
  $('#btn-cancel-contractor')?.classList.add('hidden');
}

function startEditContractor(c) {
  editingContractorId = c.id;
  $('#new-contractor-name').value = c.name || '';
  $('#new-contractor-inn').value = c.inn || '';
  $('#new-contractor-executor').value = c.executor || '';
  if ($('#new-contractor-email')) $('#new-contractor-email').value = c.email || '';
  const btn = $('#btn-add-contractor');
  if (btn) btn.textContent = 'Сохранить';
  const title = $('#contractor-form-title');
  if (title) title.textContent = 'Данные компании';
  $('#btn-cancel-contractor')?.classList.remove('hidden');
  document.querySelector('#screen-settings-contractors .inline-form')?.scrollIntoView({ behavior: 'smooth' });
}

async function renderContractorsSettings() {
  const { contractors } = await refreshDirectories();
  updateExecutorsDatalist();
  const el = $('#contractors-list');
  if (!contractors.length) {
    el.innerHTML = '<p style="color:var(--muted);font-size:0.9rem">Нет организаций</p>';
    return;
  }
  el.innerHTML = contractors
    .map(
      (c) => `
    <div class="dir-item" data-id="${c.id}">
      <span class="picker-icon">${window.VCIcons ? VCIcons.svg('org', { size: 20 }) : ''}</span>
      <main role="button" tabindex="0" data-edit-contractor="${c.id}" style="cursor:pointer;flex:1">
        <div class="title">${escapeHtml(c.name)}</div>
        <div class="sub">${c.inn ? 'ИНН ' + escapeHtml(c.inn) : 'ИНН не указан'}${c.executor ? ' · Исп.: ' + escapeHtml(c.executor) : ''}${c.email ? ' · ' + escapeHtml(c.email) : ''}</div>
      </main>
      <button type="button" class="btn-delete" data-delete-contractor="${c.id}" aria-label="Удалить">×</button>
    </div>`
    )
    .join('');
  el.querySelectorAll('[data-edit-contractor]').forEach((btn) => {
    const openEdit = () => {
      const c = contractors.find((x) => x.id === btn.dataset.editContractor);
      if (c) startEditContractor(c);
    };
    btn.onclick = openEdit;
    btn.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openEdit();
      }
    };
  });
  el.querySelectorAll('[data-delete-contractor]').forEach((btn) => {
    btn.onclick = () => deleteContractor(btn.dataset.deleteContractor);
  });
}

async function deleteObject(id) {
  if (!confirm('Удалить объект?')) return;
  try {
    if (apiMode) await VictoryAPI.deleteObject(id);
    else {
      const d = loadLocalDirectories();
      d.objects = d.objects.filter((o) => o.id !== id);
      saveLocalDirectories(d);
      setRefs(d.objects, d.contractors);
    }
    toast('Объект удалён');
    await renderObjectsSettings();
  } catch (e) {
    toast(e.message);
  }
}

async function deleteContractor(id) {
  if (!confirm('Удалить организацию?')) return;
  try {
    if (apiMode) await VictoryAPI.deleteContractor(id);
    else {
      const d = loadLocalDirectories();
      d.contractors = d.contractors.filter((c) => c.id !== id);
      saveLocalDirectories(d);
      setRefs(d.objects, d.contractors);
    }
    toast('Организация удалена');
    await renderContractorsSettings();
  } catch (e) {
    toast(e.message);
  }
}

async function addObject() {
  const name = $('#new-object-name').value.trim();
  const code = $('#new-object-code').value.trim().toUpperCase();
  const address = $('#new-object-address').value.trim();
  if (!name || !code) {
    toast('Укажите название и код');
    return;
  }
  try {
    if (apiMode) {
      await VictoryAPI.createObject({ name, code, address });
    } else {
      const d = loadLocalDirectories();
      if (d.objects.some((o) => o.code === code)) throw new Error('Код уже занят');
      d.objects.push({ id: 'o' + Date.now(), name, code, address });
      saveLocalDirectories(d);
      setRefs(d.objects, d.contractors);
    }
    $('#new-object-name').value = '';
    $('#new-object-code').value = '';
    $('#new-object-address').value = '';
    toast('Объект добавлен');
    await renderObjectsSettings();
  } catch (e) {
    toast(e.message);
  }
}

async function addContractor() {
  const name = $('#new-contractor-name').value.trim();
  const inn = $('#new-contractor-inn').value.trim();
  const executor = $('#new-contractor-executor').value.trim();
  const email = $('#new-contractor-email')?.value.trim() || '';
  if (!name) {
    toast('Укажите название');
    return;
  }
  try {
    if (editingContractorId) {
    if (apiMode) {
        await VictoryAPI.patchContractor(editingContractorId, { name, inn, executor, email });
    } else {
      const d = loadLocalDirectories();
        const c = d.contractors.find((x) => x.id === editingContractorId);
        if (!c) throw new Error('Организация не найдена');
        c.name = name;
        c.inn = inn;
        c.executor = executor;
        c.email = email;
        c.type = /^ИП\s/i.test(name) ? 'ip' : 'ooo';
      saveLocalDirectories(d);
      setRefs(d.objects, d.contractors);
    }
      resetContractorForm();
      toast('Организация обновлена');
    } else if (apiMode) {
      await VictoryAPI.createContractor({ name, inn, executor, email });
      resetContractorForm();
    toast('Организация добавлена');
    } else {
      const d = loadLocalDirectories();
      d.contractors.push({
        id: 'c' + Date.now(),
        name,
        type: /^ИП\s/i.test(name) ? 'ip' : 'ooo',
        inn,
        executor,
        email,
      });
      saveLocalDirectories(d);
      setRefs(d.objects, d.contractors);
      resetContractorForm();
      toast('Организация добавлена');
    }
    await renderContractorsSettings();
  } catch (e) {
    toast(e.message);
  }
}

document.querySelectorAll('[data-theme-btn]').forEach((btn) => {
  btn.addEventListener('click', () => VCTheme.apply(btn.dataset.themeBtn));
});

$('#goto-settings-objects')?.addEventListener('click', () => showScreen('settings-objects'));
$('#goto-settings-contractors')?.addEventListener('click', () => showScreen('settings-contractors'));
$('#settings-objects-back')?.addEventListener('click', () => showScreen('profile'));
$('#settings-contractors-back')?.addEventListener('click', () => {
  resetContractorForm();
  showScreen('profile');
});
$('#btn-add-object')?.addEventListener('click', () => addObject().catch((e) => toast(e.message)));
$('#btn-add-contractor')?.addEventListener('click', () => addContractor().catch((e) => toast(e.message)));
$('#btn-cancel-contractor')?.addEventListener('click', () => {
  resetContractorForm();
});

$('#goto-notification-settings')?.addEventListener('click', () => showScreen('notification-settings'));
$('#goto-profile-edit')?.addEventListener('click', () => showScreen('profile-edit'));
$('#profile-edit-back')?.addEventListener('click', () => showScreen('profile'));
$('#profile-edit-save')?.addEventListener('click', () => saveProfileEdit());
$('#notification-settings-back')?.addEventListener('click', () => showScreen('profile'));

$('#report-cancel')?.addEventListener('click', () => closeReportSheet(null));
$('#report-submit')?.addEventListener('click', () => {
  const photosOnly = !!reportSheetState.photosOnly;
  const text = $('#report-text')?.value.trim() || '';
  if (!photosOnly && !text) {
    toast('Опишите выполненные работы');
    return;
  }
  if (photosOnly && !reportSheetState.media.length) {
    toast('Выберите хотя бы одно фото');
    return;
  }
  closeReportSheet({
    text: photosOnly ? 'Дополнительные фото к отчёту' : text,
    media: reportSheetState.media.slice(),
  });
});
$('#report-file')?.addEventListener('change', async (e) => {
  const input = e.target;
  const files = input.files ? [...input.files] : [];
  input.value = '';
  const room = 10 - reportSheetState.media.length;
  for (const file of files.slice(0, room)) {
    try {
      const dataUrl = await compressImageFile(file);
      if (dataUrl) reportSheetState.media.push(dataUrl);
    } catch (_) {}
  }
  renderReportMediaGrid();
});
$('#report-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'report-modal') closeReportSheet(null);
});

$('#comment-cancel')?.addEventListener('click', () => closeCommentSheet(null));
$('#comment-submit')?.addEventListener('click', () => {
  const text = $('#comment-text')?.value.trim() || '';
  if (!text) {
    toast('Введите комментарий');
    return;
  }
  closeCommentSheet(text);
});
$('#comment-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'comment-modal') closeCommentSheet(null);
});

$('#status-cancel')?.addEventListener('click', () => closeStatusSheet(null));
$('#status-submit')?.addEventListener('click', () => {
  const picked =
    statusSheetState.picked || $('#status-pick-list .picker-item.selected')?.dataset.status;
  if (!picked) {
    toast('Выберите статус');
    return;
  }
  closeStatusSheet(picked);
});
$('#status-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'status-modal') closeStatusSheet(null);
});

/* ——— Avatar → profile ——— */
$('#user-avatar')?.addEventListener('click', () => {
  $$('.nav-item').forEach((b) => b.classList.remove('active'));
  $$('.nav-item[data-screen="profile"]')[0]?.classList.add('active');
  showScreen('profile');
});

setupServerConfigUi();
initAppMenu();
initNav();
initDetailActions();
initViolationsList();
window.store = store;
window.showScreen = showScreen;
window.userPerms = userPerms;
window.needsApproval = needsApproval;
window.persist = persist;
window.openDetail = openDetail;
window.startWizard = startWizard;
window.renderList = renderList;
window.syncViolations = syncViolations;
window.isTrainingTicketForMe = isTrainingTicketForMe;
window.VCOnboarding?.bindUi();
initApp().catch((e) => {
  toast(e.message || 'Ошибка запуска');
  if (restoreCachedSession()) boot();
  else showScreen('login');
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (hasPersistedSession() && !store.user) {
    restoreCachedSession();
    boot();
  }
});
