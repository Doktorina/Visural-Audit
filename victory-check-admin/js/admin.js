const AdminAPI = {
  base() {
    if (window.VC_API_URL) return String(window.VC_API_URL).replace(/\/$/, '');

    const proto = String(location.protocol || '').toLowerCase();
    const origin = String(location.origin || '').replace(/\/$/, '');
    const host = String(location.hostname || '').toLowerCase();

    // В нативной оболочке (capacitor://, file://, android_asset и т.п.) origin не подходит для API.
    const isHttp = proto === 'http:' || proto === 'https:';
    const isAppLike =
      !isHttp ||
      origin === 'null' ||
      !host ||
      origin.startsWith('capacitor://') ||
      origin.startsWith('ionic://') ||
      /android_asset/i.test(location.href || '') ||
      /flutter_assets/i.test(location.href || '');

    if (isAppLike) {
      const saved = (localStorage.getItem('vc_server_url') || '').trim().replace(/\/+$/, '');
      const server = saved || 'https://audit.visural.ru';
      return `${server.replace(/\/$/, '')}/api`;
    }

    return `${origin}/api`;
  },
  token() {
    return localStorage.getItem('vc_admin_token') || localStorage.getItem('vc_token');
  },
  setToken(t) {
    if (t) {
      localStorage.setItem('vc_admin_token', t);
      localStorage.setItem('vc_token', t);
    } else {
      localStorage.removeItem('vc_admin_token');
      localStorage.removeItem('vc_token');
    }
  },
  async req(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const t = this.token();
    if (t) headers.Authorization = `Bearer ${t}`;
    const res = await fetch(`${this.base()}${path}`, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  },
  async download(path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const t = this.token();
    if (t) headers.Authorization = `Bearer ${t}`;
    const res = await fetch(`${this.base()}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) {
      let err = 'Не удалось скачать файл';
      try {
        const data = await res.json();
        err = data.error || err;
      } catch (_) {}
      throw new Error(err);
    }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename="?([^";]+)"?/i);
    return { blob, filename: m ? m[1] : 'akt-predpisanie.docx' };
  },
};

let refs = { objects: [], contractors: [] };
let violations = [];
let violPage = 1;
const VIOL_PAGE_SIZE = 6;

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const PAGE_TITLES = {
  dashboard: 'Дашборд',
  analytics: 'Аналитика',
  history: 'История нарушений',
  violations: 'Нарушения',
  objects: 'Объекты строительства',
  categories: 'Категории нарушений',
  contractors: 'Организации',
  users: 'Пользователи',
  notifications: 'Уведомления',
};

let adminNotifications = [];

const ROLE_LABELS = {
  admin: 'Администратор',
  auditor: 'Аудитор',
  contractor: 'Подрядчик',
  viewer: 'Наблюдатель',
};

const STATUS_LABELS = {
  pending: 'Ожидает',
  active: 'Активен',
  rejected: 'Отклонён',
};

let appUsers = [];
let pendingRegistrations = [];

function animateIn(el, cls) {
  if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

function activateAdminShell() {
  requestAnimationFrame(() => $('#app-layout')?.classList.add('admin-ready'));
}

function show(id) {
  $$('.page').forEach((p) => {
    p.classList.add('hidden');
    p.classList.remove('page-enter');
  });
  const page = $(`#page-${id}`);
  if (page) {
    page.classList.remove('hidden');
    animateIn(page, 'page-enter');
  }
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.page === id));
  $('#page-title').textContent = PAGE_TITLES[id] || id;
  if (id === 'objects') renderObjectsTable();
  if (id === 'categories') renderCategoriesTable();
  if (id === 'contractors') {
    loadUsers()
      .catch(() => {})
      .finally(() => renderContractorsTable());
  }
  if (id === 'users') loadUsers().catch((e) => alert(e.message));
  if (id === 'notifications') {
    initNotifyFilters();
    loadUsers()
      .catch(() => {})
      .finally(() => renderNotificationsPage());
  }
  if (id === 'analytics' && window.VCAnalytics) {
    VCAnalytics.onShow({ objects: refs.objects, contractors: refs.contractors }).catch((e) =>
      adminToast(e.message, true)
    );
  }
  if (id === 'violations') {
    showViolationList();
    renderViolationsTable();
  }
  if (id === 'history' && window.VCHistory) {
    VCHistory.onShow({ objects: refs.objects, contractors: refs.contractors, categories: refs.categories }).catch(
      (e) => adminToast(e.message, true)
    );
  }
}

async function loadUsers() {
  const data = await AdminAPI.req('/users');
  appUsers = data.users || [];
  window.appUsers = appUsers;
  pendingRegistrations = data.pendingRegistrations || [];
  updateUsersNavBadge();
  renderUsersTable();
  refreshUserPickers();
}
window.loadUsers = loadUsers;

function refreshUserPickers() {
  const users = appUsers || [];
  const notifyEl = $('#notify-user-picker');
  const qaEl = $('#qa-user-picker');
  if (notifyEl?._vcPicker) window.VCUserPicker?.setUsers(notifyEl, users);
  if (qaEl?._vcPicker) window.VCUserPicker?.setUsers(qaEl, users);
  if (selectedContractorId) mountAssignUserPicker(selectedContractorId);
}

function updateUsersNavBadge() {
  const pendingCount = appUsers.filter((u) => (u.status || 'active') === 'pending').length;
  const usersNav = $$('.nav-btn[data-page="users"]')[0];
  if (usersNav) {
    const label = usersNav.querySelector('.nav-label');
    if (label) {
      label.textContent = pendingCount
        ? `Пользователи (${pendingCount})`
        : 'Пользователи';
    }
  }
  const countEl = $('#users-total-count');
  if (countEl) {
    countEl.textContent = `Всего: ${appUsers.length}${
      pendingRegistrations.length ? ` · не завершили регистрацию: ${pendingRegistrations.length}` : ''
    }`;
  }
}

async function login(e) {
  e.preventDefault();
  try {
    const email = $('#login-email').value.trim();
    const password = $('#login-password').value;
    const data = await AdminAPI.req('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (data.user.role !== 'admin') {
      throw new Error('Доступ только для роли admin');
    }
    localStorage.setItem('vc_admin_token', data.token);
    localStorage.setItem('vc_token', data.token);
    $('#user-label').textContent = data.user.name;
    const sn = $('#sidebar-user-name');
    const si = $('#sidebar-user-initials');
    if (sn) sn.textContent = data.user.name;
    if (si) si.textContent = userInitials(data.user.name);
    $('#login-screen').classList.add('hidden');
    $('#app-layout').classList.remove('hidden');
    activateAdminShell();
    updateMobileLink();
    await loadAll();
    show('analytics');
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
}

function logout() {
  AdminAPI.setToken(null);
  sessionStorage.removeItem('vc_mode');
  location.reload();
}

function applyTokenFromUrl() {
  const params = new URLSearchParams(location.search);
  const token = params.get('token');
  if (token) {
    AdminAPI.setToken(token);
    history.replaceState({}, '', location.pathname);
  }
}

function updateMobileLink() {
  const link = $('#nav-mobile');
  if (!link) return;
  const token = AdminAPI.token();
  link.href = token ? `/mobile/?token=${encodeURIComponent(token)}` : '/mobile/';
}

async function loadAdminNotifications() {
  try {
    const { notifications } = await AdminAPI.req('/notifications');
    adminNotifications = notifications || [];
  } catch {
    adminNotifications = [];
  }
  updateNotificationsBadge();
}

function updateNotificationsBadge() {
  const unread = adminNotifications.filter((n) => !(n.isRead || n.read)).length;
  const pending = appUsers.filter((u) => (u.status || 'active') === 'pending').length;
  const total = unread + pending;
  const badge = $('#nav-notify-badge');
  if (!badge) return;
  if (total > 0) {
    badge.textContent = String(total);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function formatNotificationDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch (_) {
    return '—';
  }
}

const NOTIF_ICONS = {
  building:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 21V9l8-5 8 5v12"/><path d="M9 21v-6h6v6"/></svg>',
  org: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 21V10l6-3 6 3v11"/><path d="M14 21V6l6-2v17"/><path d="M8 13h.01M8 17h.01"/><path d="M18 10h.01M18 14h.01"/></svg>',
  new: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.6L2.6 17a2 2 0 001.7 3h15.4a2 2 0 001.7-3L13.7 3.6a2 2 0 00-3.4 0Z"/></svg>',
  overdue:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  resolved:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
  assigned:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0114 0"/></svg>',
  clock:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  warn:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.6L2.6 17a2 2 0 001.7 3h15.4a2 2 0 001.7-3L13.7 3.6a2 2 0 00-3.4 0Z"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
};

function stripNotifEmoji(text) {
  return String(text || '')
    .replace(/^[\u{1F300}-\u{1FAFF}\u2600-\u27BF\uFE0F]+\s*/u, '')
    .trim();
}

function notifViolation(n) {
  if (!n?.violationId) return null;
  return violations.find((v) => v.id === n.violationId) || null;
}

function notifObjectName(n, v) {
  if (v?.objectId) {
    const obj = refs.objects.find((o) => o.id === v.objectId);
    if (obj?.name) return obj.name;
  }
  const msg = String(n.message || '');
  const parts = msg.split('•').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 1 && !parts[0].includes('Отправлено')) return parts[0];
  return '—';
}

function notifContractorName(n, v) {
  if (v?.contractorId) {
    const org = refs.contractors.find((c) => c.id === v.contractorId);
    if (org?.name) return org.name;
  }
  const msg = String(n.message || '');
  const parts = msg.split('•').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[1];
  const userId = n.payload?.userId;
  if (userId) {
    const u = appUsers.find((x) => x.id === userId);
    if (u?.company) return u.company;
  }
  return '—';
}

function classifyNotification(n) {
  const t = String(n.type || '').toLowerCase();
  const title = String(n.title || '').toLowerCase();
  const msg = String(n.message || '').toLowerCase();
  if (
    t.includes('assigned') ||
    t.includes('user_') ||
    /пользователь|назначен|подтвержден/i.test(title) ||
    /назначен/i.test(msg)
  ) {
    return 'assigned';
  }
  if (
    t.includes('expired') ||
    t.includes('overdue') ||
    /срок истёк|просроч/i.test(title) ||
    /просроч|срок устранения прошёл/i.test(msg)
  ) {
    return 'overdue';
  }
  if (
    t.includes('resolved') ||
    /устранен|отчёт|закрыт|на проверке/i.test(title) ||
    /отчёт об устранении/i.test(msg)
  ) {
    return 'resolved';
  }
  return 'new';
}

function formatNotifDeadlineLine(v, kind) {
  if (!v?.deadline) {
    if (kind === 'overdue') return { cls: 'bad', icon: 'warn', text: 'Просрочено' };
    if (kind === 'resolved') return { cls: 'ok', icon: 'check', text: 'Закрыто в срок' };
    return null;
  }
  const d = new Date(v.deadline);
  const now = new Date();
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (kind === 'resolved' || v.status === 'resolved') {
    return { cls: 'ok', icon: 'check', text: 'Закрыто в срок' };
  }
  if (kind === 'overdue' || d < now || v.status === 'overdue') {
    const days = Math.max(1, Math.ceil((now - d) / 86400000));
    const dayWord = days === 1 ? 'день' : days < 5 ? 'дня' : 'дней';
    return { cls: 'bad', icon: 'warn', text: `Просрочено на ${days} ${dayWord}` };
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  let text;
  if (d.toDateString() === now.toDateString()) text = `Срок: сегодня до ${time}`;
  else if (d.toDateString() === tomorrow.toDateString()) text = `Срок: завтра до ${time}`;
  else text = `Срок: ${d.toLocaleDateString('ru-RU')} до ${time}`;
  return { cls: 'warn', icon: 'clock', text };
}

function notifDisplayTitle(n, v, kind) {
  const raw = stripNotifEmoji(n.title || 'Уведомление');
  if (v) {
    if (kind === 'new' || /новое нарушение/i.test(raw)) return `Новое нарушение №${v.number}`;
    if (kind === 'overdue' || /срок истёк|срок скоро/i.test(raw)) {
      return /скоро/i.test(raw) ? `Срок скоро · №${v.number}` : `Срок истёк · №${v.number}`;
    }
    if (kind === 'resolved' || /отчёт|устранен/i.test(raw)) return `Нарушение устранено · №${v.number}`;
    if (kind === 'assigned' || /назначен/i.test(raw)) return `Назначен ответственный · №${v.number}`;
    if (v.number && !raw.includes(v.number)) return `${raw} · №${v.number}`;
  }
  return raw;
}

function renderNotifCard(n) {
  const unread = !(n.isRead || n.read);
  const v = notifViolation(n);
  const kind = classifyNotification(n);
  const obj = notifObjectName(n, v);
  const org = notifContractorName(n, v);
  const title = notifDisplayTitle(n, v, kind);
  const status = formatNotifDeadlineLine(v, kind);
  const iconCls = `notif-icon-${kind === 'new' ? 'new' : kind}`;
  const violationAttr = v ? ` data-violation-id="${escapeHtml(v.id)}"` : '';
  const userId = n.payload?.userId || '';

  return `
    <article class="notif-item${unread ? ' unread' : ''}" data-notify-id="${escapeHtml(n.id)}"${violationAttr}>
      <div class="notif-item-icon ${iconCls}">${NOTIF_ICONS[kind] || NOTIF_ICONS.new}</div>
      <div class="notif-item-body">
        <div class="notif-item-title-row">
          <strong class="notif-item-title">${escapeHtml(title)}</strong>
          ${unread ? '<span class="notif-badge-new">НОВОЕ</span>' : ''}
        </div>
        <div class="notif-item-meta">
          <span class="notif-meta-chip">${NOTIF_ICONS.building}<span>${escapeHtml(obj)}</span></span>
          <span class="notif-meta-chip">${NOTIF_ICONS.org}<span>${escapeHtml(org)}</span></span>
        </div>
        ${
          status
            ? `<div class="notif-item-status notif-status-${status.cls}">${NOTIF_ICONS[status.icon] || ''}${escapeHtml(status.text)}</div>`
            : n.message
              ? `<div class="notif-item-status">${escapeHtml(stripNotifEmoji(n.message).split('\n')[0])}</div>`
              : ''
        }
        <time class="notif-item-time">${formatNotificationDate(n.createdAt || n.at)}</time>
      </div>
      ${
        unread
          ? `<button type="button" class="notif-read-btn" data-read-notify="${escapeHtml(n.id)}">Прочитано</button>`
          : userId
            ? `<button type="button" class="notif-read-btn" data-open-user="${escapeHtml(userId)}">К пользователю</button>`
            : ''
      }
    </article>`;
}

function renderPendingUserNotifCard(u) {
  return `
    <article class="notif-item unread">
      <div class="notif-item-icon notif-icon-assigned">${NOTIF_ICONS.assigned}</div>
      <div class="notif-item-body">
        <div class="notif-item-title-row">
          <strong class="notif-item-title">Новый пользователь — ${escapeHtml(u.name || '—')}</strong>
          <span class="notif-badge-new">НОВОЕ</span>
        </div>
        <div class="notif-item-meta">
          <span class="notif-meta-chip">${NOTIF_ICONS.org}<span>${escapeHtml(u.company || '—')}</span></span>
          <span class="notif-meta-chip"><span>${escapeHtml(u.phone || u.email || '—')}</span></span>
        </div>
        <div class="notif-item-status notif-status-warn">${NOTIF_ICONS.clock}Ожидает подтверждения</div>
        <div class="notif-pending-actions">
          <button type="button" class="notif-tool-btn" data-goto-users="1">Подтвердить в разделе «Пользователи»</button>
        </div>
      </div>
    </article>`;
}

async function markAllNotificationsRead() {
  await AdminAPI.req('/notifications/read-all', { method: 'POST' });
  adminNotifications.forEach((n) => {
    n.read = true;
    n.isRead = true;
  });
  updateNotificationsBadge();
}

function wireAssignTabs() {
  const tabs = $$('.assign-tab');
  if (!tabs.length || wireAssignTabs._done) return;
  wireAssignTabs._done = true;
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const id = tab.dataset.assignTab;
      tabs.forEach((t) => t.classList.toggle('active', t === tab));
      $('#assign-tab-link')?.classList.toggle('hidden', id !== 'link');
      $('#assign-tab-new')?.classList.toggle('hidden', id !== 'new');
    });
  });
}
async function markNotificationRead(id) {
  await AdminAPI.req(`/notifications/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ read: true }),
  });
  const n = adminNotifications.find((x) => x.id === id);
  if (n) {
    n.read = true;
    n.isRead = true;
  }
  updateNotificationsBadge();
}

async function renderNotificationsPage() {
  await loadAdminNotifications();
  const el = $('#notifications-list');
  if (!el) return;

  const pending = appUsers.filter((u) => (u.status || 'active') === 'pending');
  const filtered = filterNotifications(adminNotifications);
  const parts = [];

  if (pending.length && !notifyFiltersActive()) {
    parts.push('<div class="notif-pending-block">');
    parts.push('<h3 class="notif-pending-title">Ожидают подтверждения</h3>');
    parts.push(pending.map(renderPendingUserNotifCard).join(''));
    parts.push('</div>');
  }

  if (filtered.length) {
    parts.push('<h2 class="notif-feed-title">История уведомлений</h2>');
    parts.push(filtered.map(renderNotifCard).join(''));
  }

  if (!parts.length) {
    el.innerHTML = `<p class="notif-empty">${notifyFiltersActive() ? 'Нет уведомлений по фильтру' : 'Нет уведомлений'}</p>`;
    return;
  }

  el.innerHTML = parts.join('');

  el.querySelectorAll('[data-goto-users]').forEach((btn) => {
    btn.addEventListener('click', () => show('users'));
  });

  el.querySelectorAll('[data-read-notify]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await markNotificationRead(btn.dataset.readNotify);
        await renderNotificationsPage();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  el.querySelectorAll('[data-open-user]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const notifyCard = btn.closest('[data-notify-id]');
        if (notifyCard?.dataset.notifyId) {
          await markNotificationRead(notifyCard.dataset.notifyId).catch(() => {});
        }
        show('users');
      } catch (err) {
        alert(err.message);
      }
    });
  });

  el.querySelectorAll('[data-violation-id]').forEach((card) => {
    card.style.cursor = 'pointer';
    card.addEventListener('click', async (e) => {
      if (e.target.closest('button')) return;
      const vid = card.dataset.violationId;
      if (!vid) return;
      const notifyCard = card.closest('[data-notify-id]');
      if (notifyCard?.dataset.notifyId) {
        await markNotificationRead(notifyCard.dataset.notifyId).catch(() => {});
      }
      show('violations');
      showViolationDetail(vid);
    });
  });
}

function notifyFiltersActive() {
  const q = $('#notify-search')?.value.trim();
  const read = $('#notify-filter-read')?.value || 'all';
  const type = $('#notify-filter-type')?.value || 'all';
  const users = window.VCUserPicker?.getSelected($('#notify-user-picker')) || [];
  return !!(q || read !== 'all' || type !== 'all' || users.length);
}

function filterNotifications(list) {
  let items = [...list];
  const q = ($('#notify-search')?.value || '').trim().toLowerCase();
  const read = $('#notify-filter-read')?.value || 'all';
  const type = $('#notify-filter-type')?.value || 'all';
  const userIds = new Set(window.VCUserPicker?.getSelected($('#notify-user-picker')) || []);

  if (read === 'unread') items = items.filter((n) => !(n.isRead || n.read));
  else if (read === 'read') items = items.filter((n) => n.isRead || n.read);

  if (type === 'admin') items = items.filter((n) => n.channel === 'admin');
  else if (type === 'telegram') items = items.filter((n) => n.channel === 'telegram');
  else if (type === 'deadline') {
    items = items.filter((n) => /deadline|срок/i.test(n.type || '') || /срок/i.test(n.title || ''));
  }

  if (userIds.size) {
    items = items.filter((n) => {
      if (n.userId && userIds.has(n.userId)) return true;
      if (n.payload?.userId && userIds.has(n.payload.userId)) return true;
      for (const uid of userIds) {
        const u = appUsers.find((x) => x.id === uid);
        if (!u) continue;
        const hay = [n.message, n.body, n.title].join(' ').toLowerCase();
        const name = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.name || '';
        if (hay.includes((u.email || '').toLowerCase())) return true;
        if (name && hay.includes(name.toLowerCase())) return true;
      }
      return false;
    });
  }

  if (q) {
    items = items.filter((n) => {
      const hay = [n.title, n.message, n.body, n.type].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }
  return items;
}

function initNotifyFilters() {
  if (initNotifyFilters._done) return;
  initNotifyFilters._done = true;
  $('#notify-advanced-toggle')?.addEventListener('click', () => {
    $('#notify-advanced')?.classList.toggle('hidden');
  });
  ['#notify-search', '#notify-filter-read', '#notify-filter-type'].forEach((sel) => {
    $(sel)?.addEventListener('input', () => renderNotificationsPage());
    $(sel)?.addEventListener('change', () => renderNotificationsPage());
  });
  if (window.VCUserPicker && $('#notify-user-picker')) {
    window.VCUserPicker.mount($('#notify-user-picker'), {
      users: appUsers,
      onChange: () => {
        clearTimeout(initNotifyFilters._userT);
        initNotifyFilters._userT = setTimeout(() => renderNotificationsPage(), 200);
      },
    });
  }
}

function filterUsersList(users) {
  let items = [...users];
  const q = ($('#users-search')?.value || '').trim().toLowerCase();
  const role = $('#users-filter-role')?.value || 'all';
  const status = $('#users-filter-status')?.value || 'all';
  if (role !== 'all') items = items.filter((u) => (u.role || 'viewer') === role);
  if (status !== 'all') items = items.filter((u) => (u.status || 'active') === status);
  if (q) {
    items = items.filter((u) => {
      const hay = [u.name, u.email, u.company, u.jobTitle, u.phone, u.firstName, u.lastName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }
  return items;
}

function initUsersFilters() {
  if (initUsersFilters._done) return;
  initUsersFilters._done = true;
  $('#users-advanced-toggle')?.addEventListener('click', () => {
    $('#users-advanced')?.classList.toggle('hidden');
  });
  ['#users-search', '#users-filter-role', '#users-filter-status'].forEach((sel) => {
    $(sel)?.addEventListener('input', () => renderUsersTable());
    $(sel)?.addEventListener('change', () => renderUsersTable());
  });
}

async function loadAll() {
  const [obj, con, cat, viol] = await Promise.all([
    AdminAPI.req('/objects'),
    AdminAPI.req('/contractors'),
    AdminAPI.req('/categories').catch(() => ({ categories: [] })),
    AdminAPI.req('/violations?filter=history'),
  ]);

  let analytics = {
    total: 0,
    resolved: 0,
    overdue: 0,
    critical: 0,
    byCategory: [],
    topOrganizations: [],
    recent: [],
  };
  try {
    analytics = await AdminAPI.req('/analytics');
  } catch (e) {
    console.error('dashboard analytics:', e);
  }

  refs.objects = obj.objects;
  refs.contractors = con.contractors;
  refs.categories = cat.categories || [];
  violations = viol.violations;
  populateViolObjectFilter();
  renderDashboard(analytics);
  renderViolationsTable();
  renderObjectsTable();
  renderCategoriesTable();
  renderContractorsTable();
  if (window.VCAnalytics) {
    VCAnalytics.init({ objects: refs.objects, contractors: refs.contractors });
  }
  if (window.VCHistory) {
    VCHistory.init({ objects: refs.objects, contractors: refs.contractors, categories: refs.categories });
  }
  if (window.VCAdminSelect) {
    VCAdminSelect.enhanceAll();
  }
  try {
    await loadUsers();
  } catch (e) {
    console.error('users load:', e);
  }
  try {
    await loadAdminNotifications();
  } catch (e) {
    console.error('notifications load:', e);
  }
  updateUsersNavBadge();
}

function adminToast(msg, isError) {
  let el = document.getElementById('admin-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'admin-toast';
    el.className = 'admin-toast hidden';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.toggle('admin-toast-error', !!isError);
  el.classList.remove('hidden', 'admin-toast-out');
  el.classList.add('admin-toast-in');
  clearTimeout(adminToast._t);
  clearTimeout(adminToast._out);
  adminToast._t = setTimeout(() => {
    el.classList.remove('admin-toast-in');
    el.classList.add('admin-toast-out');
    adminToast._out = setTimeout(() => el.classList.add('hidden'), 320);
  }, 3200);
}
window.adminToast = adminToast;

function mediaUrl(src) {
  if (!src) return '';
  const s = String(src);
  if (s.startsWith('data:') || /^https?:\/\//i.test(s)) return s;
  if (s.startsWith('/')) {
    const origin = window.location.origin.replace(/\/$/, '');
    if (origin && origin !== 'null') return origin + s;
    return 'https://audit.visural.ru' + s;
  }
  return s;
}

function categoryForViolation(v) {
  const cat = (refs.categories || []).find((c) => c.id === v.categoryId);
  if (v.categoryId === 'other' && v.categoryOther) {
    return { name: v.categoryOther, icon: cat?.icon || 'ic-other' };
  }
  return cat || { name: v.categoryId || '—', icon: 'ic-other' };
}

function userInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

function formatViolDeadline(v) {
  if (!v.deadline) return '—';
  const d = new Date(v.deadline);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dl = new Date(d);
  dl.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dl - now) / 86400000);
  const st = effectiveViolStatus(v);
  const shortDate = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });

  if (st === 'overdue') {
    const days = Math.abs(diffDays) || 1;
    const word = days % 10 === 1 && days % 100 !== 11 ? 'день' : days % 10 >= 2 && days % 10 <= 4 && (days % 100 < 10 || days % 100 >= 20) ? 'дня' : 'дней';
    return `<span class="viol-deadline-over">-${days} ${word}</span>`;
  }
  if (st === 'resolved') {
    return `<span class="viol-deadline-done">${shortDate}</span>`;
  }
  return shortDate;
}

let lightboxPhotos = [];
let lightboxIndex = 0;
let currentViolDetailId = null;

function openPhotoLightbox(photos, startIndex = 0) {
  lightboxPhotos = photos.filter(Boolean);
  if (!lightboxPhotos.length) return;
  lightboxIndex = Math.max(0, Math.min(startIndex, lightboxPhotos.length - 1));
  const lb = $('#photo-lightbox');
  lb.classList.remove('hidden');
  lb.setAttribute('aria-hidden', 'false');
  updateLightboxImage();
}

function closePhotoLightbox() {
  const lb = $('#photo-lightbox');
  lb.classList.add('hidden');
  lb.setAttribute('aria-hidden', 'true');
  $('#lightbox-img').src = '';
}

function updateLightboxImage() {
  $('#lightbox-img').src = mediaUrl(lightboxPhotos[lightboxIndex]);
  $('#lightbox-counter').textContent = `${lightboxIndex + 1} / ${lightboxPhotos.length}`;
}

function initPhotoLightbox() {
  $('#lightbox-close')?.addEventListener('click', closePhotoLightbox);
  $('#photo-lightbox')?.addEventListener('click', (e) => {
    if (e.target.id === 'photo-lightbox') closePhotoLightbox();
  });
  $('#lightbox-prev')?.addEventListener('click', (e) => {
    e.stopPropagation();
    lightboxIndex = (lightboxIndex - 1 + lightboxPhotos.length) % lightboxPhotos.length;
    updateLightboxImage();
  });
  $('#lightbox-next')?.addEventListener('click', (e) => {
    e.stopPropagation();
    lightboxIndex = (lightboxIndex + 1) % lightboxPhotos.length;
    updateLightboxImage();
  });
  document.addEventListener('keydown', (e) => {
    if ($('#photo-lightbox')?.classList.contains('hidden')) return;
    if (e.key === 'Escape') closePhotoLightbox();
    if (e.key === 'ArrowLeft') $('#lightbox-prev')?.click();
    if (e.key === 'ArrowRight') $('#lightbox-next')?.click();
  });
}

function formatHistoryDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (_) {
    return '—';
  }
}

function photoCountLabel(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} снимок`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} снимка`;
  return `${n} снимков`;
}

function collectFixationPhotos(v) {
  return Array.isArray(v?.media) ? v.media.filter(Boolean) : [];
}

function collectReportPhotos(v) {
  const fromField = Array.isArray(v?.reportMedia) ? v.reportMedia.filter(Boolean) : [];
  const fromComments = [];
  for (const c of v?.comments || []) {
    if (c?.type !== 'report') continue;
    for (const m of c.media || []) {
      if (m) fromComments.push(m);
    }
  }
  const seen = new Set();
  const out = [];
  for (const m of [...fromField, ...fromComments]) {
    const key = String(m);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

function formatViolDeadlineDetail(v) {
  if (!v.deadline) return '—';
  const d = new Date(v.deadline);
  const dateStr = d.toLocaleDateString('ru-RU');
  const st = effectiveViolStatus(v);
  if (st === 'overdue') {
    const diffDays = Math.abs(Math.round((d - new Date()) / 86400000)) || 1;
    const mod10 = diffDays % 10;
    const mod100 = diffDays % 100;
    const word =
      mod10 === 1 && mod100 !== 11 ? 'день' : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20) ? 'дня' : 'дней';
    return `<span class="viol-deadline-over">${dateStr} · -${diffDays} ${word}</span>`;
  }
  if (st === 'resolved') {
    return `<span class="viol-deadline-done">${dateStr}</span>`;
  }
  return dateStr;
}

const TIMELINE_ICONS = {
  created:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  assigned:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0114 0"/></svg>',
  comment:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M5 5h14a2 2 0 012 2v9a2 2 0 01-2 2H9l-4 3V7a2 2 0 012-2Z"/></svg>',
  reject:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
  expired:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  system:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="12" cy="12" r="2"/></svg>',
};

function buildViolTimeline(v) {
  const events = [];
  const history = Array.isArray(v.history) ? [...v.history] : [];
  const comments = Array.isArray(v.comments) ? [...v.comments] : [];

  const createdH = history.find((h) => /создан/i.test(h.text));
  events.push({
    at: createdH?.at || v.createdAt,
    type: 'created',
    title: 'Нарушение зафиксировано',
    meta: `${createdH?.by || v.createdByName || '—'} · ${formatHistoryDate(createdH?.at || v.createdAt)}`,
  });

  const assignH = history.find((h) => /ответственн|назначен/i.test(h.text) && !/создан/i.test(h.text));
  if (v.responsible) {
    events.push({
      at: assignH?.at || v.createdAt,
      type: 'assigned',
      title: assignH?.text?.includes('ответствен') ? assignH.text : `Назначен ответственный — ${v.responsible}`,
      meta: formatHistoryDate(assignH?.at || v.createdAt),
    });
  }

  comments.forEach((c) => {
    const isReject = c.type === 'reject';
    const isReport = c.type === 'report';
    events.push({
      at: c.at,
      type: isReject ? 'reject' : 'comment',
      title: isReject ? 'Отчёт отклонён' : isReport ? 'Отчёт об устранении' : 'Комментарий',
      meta: `«${(c.text || '').slice(0, 160)}» · ${c.by || '—'} · ${formatHistoryDate(c.at)}`,
      photos: Array.isArray(c.media) ? c.media.filter(Boolean) : [],
    });
  });

  history.forEach((h) => {
    if (/создан/i.test(h.text)) return;
    if (/ответственн|назначен/i.test(h.text) && v.responsible) return;
    if (/осталось менее|уведомление на почту/i.test(h.text) && !/истёк/i.test(h.text)) return;
    if (/отчёт отклонён/i.test(h.text)) return;
    if (/срок устранения истёк/i.test(h.text)) {
      events.push({
        at: h.at,
        type: 'expired',
        title: 'Срок устранения истёк',
        meta: formatHistoryDate(h.at),
      });
      return;
    }
    events.push({
      at: h.at,
      type: 'system',
      title: h.text,
      meta: `${h.by || '—'} · ${formatHistoryDate(h.at)}`,
    });
  });

  if (effectiveViolStatus(v) === 'overdue' && !events.some((e) => e.type === 'expired') && v.deadline) {
    events.push({
      at: v.deadline,
      type: 'expired',
      title: 'Срок устранения истёк',
      meta: formatHistoryDate(v.deadline),
    });
  }

  events.sort((a, b) => new Date(a.at) - new Date(b.at));
  return events;
}

function renderViolTimeline(v) {
  const events = buildViolTimeline(v);
  if (!events.length) {
    return '<p style="color:var(--muted);font-size:0.85rem">Нет записей</p>';
  }
  return events
    .map((e, ei) => {
      const photos = Array.isArray(e.photos) ? e.photos.filter(Boolean) : [];
      const photosHtml = photos.length
        ? `<div class="viol-timeline-photos" data-ev="${ei}">${photos
            .map(
              (m, i) =>
                `<button type="button" class="viol-timeline-photo" data-ev="${ei}" data-i="${i}" aria-label="Фото ${i + 1}"><img src="${mediaUrl(m)}" alt=""></button>`
            )
            .join('')}</div>`
        : '';
      return `<div class="viol-timeline-item">
        <div class="viol-timeline-icon ${escapeHtml(e.type)}">${TIMELINE_ICONS[e.type] || TIMELINE_ICONS.system}</div>
        <div class="viol-timeline-body">
          <div class="viol-timeline-title">${escapeHtml(e.title)}</div>
          <div class="viol-timeline-meta">${escapeHtml(e.meta)}</div>
          ${photosHtml}
        </div>
      </div>`;
    })
    .join('');
}

function bindViolTimelinePhotos(v) {
  const events = buildViolTimeline(v);
  $('#viol-detail-history')?.querySelectorAll('.viol-timeline-photo').forEach((btn) => {
    btn.onclick = () => {
      const ev = events[Number(btn.dataset.ev)];
      const photos = Array.isArray(ev?.photos) ? ev.photos.filter(Boolean) : [];
      if (!photos.length) return;
      openPhotoLightbox(photos, Number(btn.dataset.i) || 0);
    };
  });
}

function showViolationList() {
  $('#viol-list-view')?.classList.remove('hidden');
  $('#viol-detail-view')?.classList.remove('open');
  currentViolDetailId = null;
  $('#page-title').textContent = PAGE_TITLES.violations;
}

function showViolationDetail(id) {
  const v = violations.find((x) => x.id === id);
  if (!v) return;
  currentViolDetailId = id;
  $('#viol-list-view')?.classList.add('hidden');
  $('#viol-detail-view')?.classList.add('open');
  $('#viol-detail-edit-panel')?.classList.add('hidden');

  const cat = categoryForViolation(v);
  const obj = refs.objects.find((o) => o.id === v.objectId)?.name || '—';
  const fixationPhotos = collectFixationPhotos(v);
  const reportPhotos = collectReportPhotos(v);
  const st = effectiveViolStatus(v);
  let galleryMode = reportPhotos.length ? 'report' : 'fixation';
  let photos = galleryMode === 'report' ? reportPhotos : fixationPhotos;

  $('#viol-detail-title').textContent = v.description || 'Нарушение';
  $('#viol-detail-meta').textContent = `${v.number} · создано ${new Date(v.createdAt).toLocaleDateString('ru-RU')}`;
  const statusEl = $('#viol-detail-status');
  statusEl.className = `badge ${st}`;
  statusEl.textContent = statusLabel(st);
  $('#viol-detail-desc').textContent = v.description || '—';

  const mainImg = $('#viol-gallery-main');
  const caption = $('#viol-gallery-caption');
  const captionText = $('#viol-gallery-caption-text');
  const thumbs = $('#viol-gallery-thumbs');
  const gpsEl = $('#viol-gallery-gps');
  const gpsText = $('#viol-gallery-gps-text');
  let tabs = $('#viol-gallery-tabs');
  if (!tabs) {
    tabs = document.createElement('div');
    tabs.id = 'viol-gallery-tabs';
    tabs.className = 'viol-gallery-tabs';
    const gallery = $('#viol-gallery');
    gallery?.insertBefore(tabs, thumbs || null);
  }

  function renderGalleryPhotos(list, label) {
    photos = list;
    if (photos.length) {
      mainImg.classList.remove('hidden');
      mainImg.src = mediaUrl(photos[0]);
      mainImg.onclick = () => openPhotoLightbox(photos, 0);
      caption?.classList.add('has-photo');
      if (captionText) captionText.textContent = `${label} · ${photoCountLabel(photos.length)}`;
      thumbs.classList.remove('hidden');
      thumbs.innerHTML = photos
        .map((m, i) => `<img src="${mediaUrl(m)}" alt="" class="${i === 0 ? 'active' : ''}" data-i="${i}">`)
        .join('');
      thumbs.querySelectorAll('img').forEach((img) => {
        img.onclick = (e) => {
          e.stopPropagation();
          const idx = Number(img.dataset.i);
          mainImg.src = mediaUrl(photos[idx]);
          thumbs.querySelectorAll('img').forEach((t) => t.classList.toggle('active', t === img));
        };
        img.ondblclick = (e) => {
          e.stopPropagation();
          openPhotoLightbox(photos, Number(img.dataset.i));
        };
      });
    } else {
      mainImg.classList.add('hidden');
      mainImg.src = '';
      caption?.classList.remove('has-photo');
      if (captionText) captionText.textContent = 'Фотофиксация отсутствует';
      thumbs.classList.add('hidden');
      thumbs.innerHTML = '';
    }
  }

  if (fixationPhotos.length || reportPhotos.length) {
    tabs.classList.remove('hidden');
    tabs.innerHTML = `
      <button type="button" class="viol-gallery-tab ${galleryMode === 'fixation' ? 'active' : ''}" data-gal="fixation" ${fixationPhotos.length ? '' : 'disabled'}>
        Фиксация${fixationPhotos.length ? ` (${fixationPhotos.length})` : ''}
      </button>
      <button type="button" class="viol-gallery-tab ${galleryMode === 'report' ? 'active' : ''}" data-gal="report" ${reportPhotos.length ? '' : 'disabled'}>
        Отчёт${reportPhotos.length ? ` (${reportPhotos.length})` : ''}
      </button>`;
    tabs.querySelectorAll('.viol-gallery-tab').forEach((btn) => {
      btn.onclick = () => {
        if (btn.disabled) return;
        galleryMode = btn.dataset.gal;
        tabs.querySelectorAll('.viol-gallery-tab').forEach((b) => b.classList.toggle('active', b === btn));
        if (galleryMode === 'report') renderGalleryPhotos(reportPhotos, 'Фото отчёта об устранении');
        else renderGalleryPhotos(fixationPhotos, 'Фотофиксация');
      };
    });
    if (galleryMode === 'report') renderGalleryPhotos(reportPhotos, 'Фото отчёта об устранении');
    else renderGalleryPhotos(fixationPhotos, 'Фотофиксация');
  } else {
    tabs.classList.add('hidden');
    tabs.innerHTML = '';
    renderGalleryPhotos([], 'Фотофиксация');
  }

  if (v.locationGps?.lat != null && v.locationGps?.lng != null) {
    gpsEl.classList.remove('hidden');
    if (gpsText) {
      gpsText.textContent = `${Number(v.locationGps.lat).toFixed(3)}, ${Number(v.locationGps.lng).toFixed(3)}`;
    }
  } else {
    gpsEl.classList.add('hidden');
  }

  const catIcon = categoryIconHtml(v, cat);
  const respInitials = userInitials(v.responsible);
  $('#viol-detail-info').innerHTML = `
    <div class="viol-kv-row">
      <span class="viol-kv-label">Категория</span>
      <span class="viol-kv-value"><span class="viol-kv-cat-ico">${catIcon}</span>${escapeHtml(cat.name)}</span>
    </div>
    <div class="viol-kv-row">
      <span class="viol-kv-label">Объект</span>
      <span class="viol-kv-value">${escapeHtml(obj)}</span>
    </div>
    <div class="viol-kv-row">
      <span class="viol-kv-label">Ответственный</span>
      <span class="viol-kv-value"><span class="viol-resp-avatar">${escapeHtml(respInitials)}</span>${escapeHtml(v.responsible || '—')}</span>
    </div>
    <div class="viol-kv-row">
      <span class="viol-kv-label">Срок</span>
      <span class="viol-kv-value">${formatViolDeadlineDetail(v)}</span>
    </div>
    <div class="viol-kv-row">
      <span class="viol-kv-label">Аудитор</span>
      <span class="viol-kv-value">${escapeHtml(v.createdByName || '—')}</span>
    </div>`;

  $('#viol-detail-history').innerHTML = renderViolTimeline(v);
  bindViolTimelinePhotos(v);

  const resolveBtn = $('#viol-detail-resolve');
  const rejectBtn = $('#viol-detail-reject');
  if (resolveBtn) {
    if (st === 'verification') resolveBtn.classList.remove('hidden');
    else resolveBtn.classList.add('hidden');
  }
  if (rejectBtn) {
    if (st === 'verification') rejectBtn.classList.remove('hidden');
    else rejectBtn.classList.add('hidden');
  }

  const commentInput = $('#viol-detail-comment');
  if (commentInput) commentInput.value = '';

  const sel = $('#viol-detail-status-select');
  sel.innerHTML = ['new', 'in_progress', 'verification', 'resolved', 'overdue']
    .map((s) => `<option value="${s}" ${v.status === s ? 'selected' : ''}>${statusLabel(s)}</option>`)
    .join('');
  sel.onchange = async () => {
    try {
      await AdminAPI.req(`/violations/${v.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: sel.value }),
      });
      await loadAll();
      showViolationDetail(v.id);
      adminToast('Статус обновлён');
    } catch (e) {
      alert(e.message);
    }
  };

  $('#viol-detail-edit').onclick = () => {
    $('#viol-detail-edit-panel')?.classList.toggle('hidden');
  };

  $('#viol-detail-comment-send').onclick = async () => {
    const text = String($('#viol-detail-comment')?.value || '').trim();
    if (!text) {
      alert('Введите текст комментария');
      return;
    }
    try {
      await AdminAPI.req(`/violations/${v.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'comment', text }),
      });
      await loadAll();
      showViolationDetail(v.id);
      adminToast('Комментарий отправлен');
    } catch (e) {
      alert(e.message);
    }
  };

  $('#viol-detail-resolve').onclick = async () => {
    if (!confirm('Принять устранение и закрыть нарушение?')) return;
    try {
      await AdminAPI.req(`/violations/${v.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'resolved' }),
      });
      await loadAll();
      showViolationDetail(v.id);
      adminToast('Устранение принято');
    } catch (e) {
      alert(e.message);
    }
  };

  $('#viol-detail-reject').onclick = async () => {
    const reason = prompt(
      'Почему отклоняете отчёт?\nПодрядчик увидит эту причину и сможет отправить отчёт заново.'
    );
    if (reason == null) return;
    const text = String(reason).trim();
    if (!text) {
      alert('Укажите причину отклонения');
      return;
    }
    try {
      await AdminAPI.req(`/violations/${v.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'reject-report', text }),
      });
      await loadAll();
      showViolationDetail(v.id);
      adminToast('Отчёт отклонён');
    } catch (e) {
      alert(e.message);
    }
  };

  $('#viol-detail-delete').onclick = async () => {
    if (!confirm(`Удалить нарушение ${v.number}?`)) return;
    try {
      await AdminAPI.req(`/violations/${v.id}`, { method: 'DELETE' });
      await loadAll();
      showViolationList();
    } catch (e) {
      alert(e.message);
    }
  };

  $('#page-title').textContent = v.number;
}

function effectiveViolStatus(v) {
  if (v.status === 'resolved') return 'resolved';
  if (v.status === 'verification') return 'verification';
  if (v.status === 'overdue') return 'overdue';
  if (v.deadline) {
    const diffDays = Math.ceil((new Date(v.deadline) - new Date()) / 86400000);
    if (diffDays < 0) return 'overdue';
  }
  if (v.status === 'in_progress') return 'in_progress';
  return v.status === 'new' ? 'new' : v.status || 'new';
}

function violMatchesFilter(v, filter) {
  const st = effectiveViolStatus(v);
  if (filter === 'all') return true;
  if (filter === 'new') return st === 'new' || st === 'in_progress';
  if (filter === 'overdue') return st === 'overdue';
  return st === filter;
}

function formatUserDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ru-RU');
  } catch (_) {
    return '—';
  }
}

let userEditId = null;

function closeUserEdit() {
  userEditId = null;
  const dlg = $('#user-edit-dialog');
  if (dlg) {
    dlg.classList.add('hidden');
    dlg.setAttribute('aria-hidden', 'true');
  }
}

function openUserEdit(userId) {
  const u = appUsers.find((x) => x.id === userId);
  if (!u) return;
  userEditId = userId;
  const dlg = $('#user-edit-dialog');
  const msg = $('#user-edit-msg');
  if (msg) msg.textContent = '';
  $('#user-edit-email').value = u.email || '';
  $('#user-edit-first').value = u.firstName || '';
  $('#user-edit-last').value = u.lastName || '';
  $('#user-edit-company').value = u.company || '';
  $('#user-edit-job-title').value = u.jobTitle || '';
  $('#user-edit-phone').value = u.phone || '';
  const roleSel = $('#user-edit-role');
  if (roleSel) {
    roleSel.innerHTML = Object.entries(ROLE_LABELS)
      .map(
        ([val, label]) =>
          `<option value="${val}"${val === (u.role || 'viewer') ? ' selected' : ''}>${escapeHtml(label)}</option>`
      )
      .join('');
  }
  fillObjectMultiSelect($('#user-edit-objects'), u.objectIds || []);
  dlg?.classList.remove('hidden');
  dlg?.setAttribute('aria-hidden', 'false');
}

async function saveUserEdit() {
  if (!userEditId) return;
  const firstName = $('#user-edit-first')?.value.trim() || '';
  const lastName = $('#user-edit-last')?.value.trim() || '';
  const email = $('#user-edit-email')?.value.trim().toLowerCase() || '';
  const company = $('#user-edit-company')?.value.trim() || '';
  const jobTitle = $('#user-edit-job-title')?.value.trim() || '';
  const phone = $('#user-edit-phone')?.value.trim() || '';
  const role = $('#user-edit-role')?.value || 'viewer';
  const objectIds = getSelectedObjectIds($('#user-edit-objects'));
  const msg = $('#user-edit-msg');
  const btn = $('#user-edit-save');
  if (!firstName) {
    if (msg) msg.textContent = 'Укажите имя';
    return;
  }
  if (!email.includes('@')) {
    if (msg) msg.textContent = 'Укажите корректный email';
    return;
  }
  if (msg) msg.textContent = '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Сохранение…';
  }
  try {
    await AdminAPI.req(`/users/${userEditId}`, {
      method: 'PATCH',
      body: JSON.stringify({ firstName, lastName, email, company, phone, jobTitle, role, objectIds }),
    });
    await loadUsers();
    closeUserEdit();
    adminToast('Профиль пользователя обновлён');
  } catch (e) {
    if (msg) msg.textContent = e.message || 'Не удалось сохранить';
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Сохранить';
    }
  }
}

const USER_AVATAR_COLORS = ['#0e7c5a', '#2e6fe0', '#e2920a', '#8b5cf6', '#084e38'];

function userDisplayName(u) {
  return (u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || '—').trim();
}

function userAvatarHtml(u, idx) {
  const url = String(u.avatarUrl || u.avatar_url || '').trim();
  if (url.startsWith('data:image/')) {
    return `<img class="user-avatar user-avatar--photo" src="${escapeHtml(url)}" alt="" width="34" height="34" loading="lazy">`;
  }
  const bg = USER_AVATAR_COLORS[idx % USER_AVATAR_COLORS.length];
  const initials = userInitials(userDisplayName(u));
  return `<span class="user-avatar" style="background:${bg}">${escapeHtml(initials)}</span>`;
}

function userStatusBadge(status) {
  const label = STATUS_LABELS[status] || status;
  const cls =
    status === 'active' ? 'resolved' : status === 'pending' ? 'verification' : status === 'rejected' ? 'overdue' : '';
  return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
}

function renderUsersTable() {
  const tbody = $('#users-table tbody');
  const pendingPanel = $('#pending-users-panel');
  const pendingList = $('#pending-users-list');
  const regPanel = $('#registration-pending-panel');
  const regList = $('#registration-pending-list');
  const pending = appUsers.filter((u) => (u.status || 'active') === 'pending');

  if (regPanel && regList) {
    regPanel.classList.toggle('hidden', !pendingRegistrations.length);
    if (pendingRegistrations.length) {
      regList.innerHTML = pendingRegistrations
        .map(
          (u) => `
        <div class="pending-user-card" style="padding:12px 0;border-bottom:1px solid var(--border)">
          <strong>${escapeHtml(u.name || u.email || '—')}</strong>
          <div style="font-size:0.85rem;color:var(--muted);margin:6px 0">
            ${escapeHtml(u.company || '—')} · ${escapeHtml(u.phone || '—')}<br>
            ${escapeHtml(u.email)} · <span style="color:var(--accent)">код на почте, регистрация не завершена</span>
          </div>
        </div>`
        )
        .join('');
    } else {
      regList.innerHTML = '';
    }
  }

  if (pendingPanel && pendingList) {
    pendingPanel.classList.toggle('hidden', !pending.length);
    if (pending.length) {
      pendingList.innerHTML = pending
        .map(
          (u) => `
        <div class="pending-user-card" style="padding:12px 0;border-bottom:1px solid var(--border)">
          <strong>${escapeHtml(u.name || '—')}</strong>
          <div style="font-size:0.85rem;color:var(--muted);margin:6px 0">
            ${escapeHtml(u.company || '—')} · ${escapeHtml(u.phone || '—')}<br>
            ${escapeHtml(u.email)}
          </div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button type="button" class="btn" data-approve-user="${escapeHtml(u.id)}">Подтвердить</button>
            <button type="button" class="btn btn-ghost" data-reject-user="${escapeHtml(u.id)}">Отклонить</button>
          </div>
        </div>`
        )
        .join('');
    } else {
      pendingList.innerHTML = '';
    }
  }

  if (!tbody) return;
  const filtered = filterUsersList(appUsers);
  const countEl = $('#users-total-count');
  if (countEl) {
    countEl.textContent = `Всего: ${filtered.length}`;
  }
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="color:var(--muted);padding:32px 16px">Нет пользователей по фильтру</td></tr>';
    return;
  }
  tbody.innerHTML = filtered
    .map((u, idx) => {
      const role = u.role || 'viewer';
      const status = u.status || 'active';
      const roleOpts = Object.entries(ROLE_LABELS)
        .map(
          ([val, label]) =>
            `<option value="${val}"${val === role ? ' selected' : ''}>${escapeHtml(label)}</option>`
        )
        .join('');
      const emailCell = u.email
        ? `<a href="mailto:${encodeURIComponent(u.email)}" class="org-email-link">${escapeHtml(u.email)}</a>`
        : '—';
      return `<tr class="users-row">
      <td>
        <div class="user-name-cell">
          ${userAvatarHtml(u, idx)}
          <button type="button" class="user-name-link" data-edit-user="${escapeHtml(u.id)}">${escapeHtml(userDisplayName(u))}</button>
        </div>
      </td>
      <td>${emailCell}</td>
      <td>${escapeHtml(u.company || '—')}</td>
      <td>${escapeHtml(u.phone || '—')}</td>
      <td>${escapeHtml(u.jobTitle || '—')}</td>
      <td>
        <select class="users-role-select" data-user-id="${escapeHtml(u.id)}" data-prev-role="${escapeHtml(role)}"${status === 'pending' ? ' disabled' : ''}>
          ${roleOpts}
        </select>
      </td>
      <td>${userStatusBadge(status)}</td>
      <td class="org-actions-cell"><button type="button" class="org-del-btn" data-del-user="${escapeHtml(u.id)}">Удалить</button></td>
    </tr>`;
    })
    .join('');

  $$('[data-approve-user]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.approveUser;
      const row = appUsers.find((u) => u.id === id);
      if (!confirm(`Подтвердить ${row?.email || ''} как подрядчика?`)) return;
      try {
        const data = await AdminAPI.req(`/users/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'active', role: 'contractor' }),
        });
        const u = appUsers.find((x) => x.id === id);
        if (u && data.user) Object.assign(u, data.user);
        await loadUsers();
      } catch (e) {
        alert(e.message);
      }
    };
  });
  $$('[data-reject-user]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.rejectUser;
      const row = appUsers.find((u) => u.id === id);
      if (!confirm(`Отклонить заявку ${row?.email || ''}?`)) return;
      try {
        const data = await AdminAPI.req(`/users/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'rejected' }),
        });
        const u = appUsers.find((x) => x.id === id);
        if (u && data.user) Object.assign(u, data.user);
        await loadUsers();
      } catch (e) {
        alert(e.message);
      }
    };
  });

  $$('.users-role-select').forEach((sel) => {
    sel.onchange = async () => {
      const id = sel.dataset.userId;
      const prev = sel.dataset.prevRole;
      const role = sel.value;
      const row = appUsers.find((u) => u.id === id);
      if (!confirm(`Сменить роль ${row?.email || ''} на «${ROLE_LABELS[role] || role}»?`)) {
        sel.value = prev;
        return;
      }
      try {
        await AdminAPI.req(`/users/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ role }),
        });
        sel.dataset.prevRole = role;
        const u = appUsers.find((x) => x.id === id);
        if (u) u.role = role;
      } catch (e) {
        alert(e.message);
        sel.value = prev;
      }
    };
  });
  $$('[data-edit-user]').forEach((btn) => {
    btn.onclick = () => openUserEdit(btn.dataset.editUser);
  });
  $$('[data-del-user]').forEach((btn) => {
    btn.onclick = async () => {
      const row = appUsers.find((u) => u.id === btn.dataset.delUser);
      if (!confirm(`Удалить пользователя ${row?.email || ''}?`)) return;
      try {
        await AdminAPI.req(`/users/${btn.dataset.delUser}`, { method: 'DELETE' });
        await loadAll();
        show('users');
      } catch (e) {
        alert(e.message);
      }
    };
  });
}

const OBJ_ROW_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M9 20v-6h6v6"/></svg>';

function renderObjectsTable() {
  $('#objects-table tbody').innerHTML = refs.objects
    .map(
      (o) => `<tr class="obj-row">
      <td class="org-name-cell">
        <span class="org-row-ico" aria-hidden="true">${OBJ_ROW_ICON}</span>
        <span class="org-name">${escapeHtml(o.name)}</span>
      </td>
      <td><span class="obj-code-pill">${escapeHtml(o.code || '—')}</span></td>
      <td>${escapeHtml(o.address || '—')}</td>
      <td class="org-actions-cell"><button type="button" class="org-del-btn" data-del-obj="${escapeHtml(o.id)}">Удалить</button></td>
    </tr>`
    )
    .join('');
  $$('[data-del-obj]').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('Удалить объект?')) return;
      try {
        await AdminAPI.req(`/objects/${btn.dataset.delObj}`, { method: 'DELETE' });
        await loadAll();
      } catch (e) {
        alert(e.message);
      }
    };
  });
}

function categoryIconCell(icon) {
  const value = String(icon || '').trim();
  if (value.startsWith('ic-')) {
    return `<img src="assets/icons-categories/${escapeHtml(value)}.png" alt="" style="width:24px;height:24px;object-fit:contain" />`;
  }
  return escapeHtml(value || '📋');
}

function renderCategoriesTable() {
  const list = [...(refs.categories || [])].sort(
    (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || String(a.name).localeCompare(String(b.name), 'ru')
  );
  $('#categories-table tbody').innerHTML = list
    .map(
      (c) => `<tr>
      <td style="font-size:1.2rem">${categoryIconCell(c.icon)}</td>
      <td>${escapeHtml(c.name)}</td>
      <td class="cat-actions" style="white-space:nowrap">
        <button type="button" class="btn btn-ghost btn-sm" data-edit-cat="${c.id}">Изменить</button>
        ${
          c.id === 'other'
            ? ''
            : `<button type="button" class="btn btn-ghost btn-sm btn-del" data-del-cat="${c.id}">Удалить</button>`
        }
      </td>
    </tr>`
    )
    .join('');
  $$('[data-edit-cat]').forEach((btn) => {
    btn.onclick = async () => {
      const cat = refs.categories.find((c) => c.id === btn.dataset.editCat);
      if (!cat) return;
      const name = prompt('Название категории', cat.name);
      if (!name || !name.trim()) return;
      const icon = prompt('Иконка (например ic-goggles)', cat.icon || 'ic-other');
      try {
        await AdminAPI.req(`/categories/${encodeURIComponent(cat.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: name.trim(), icon: (icon || cat.icon || 'ic-other').trim() }),
        });
        await loadAll();
        show('categories');
      } catch (e) {
        alert(e.message);
      }
    };
  });
  $$('[data-del-cat]').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('Удалить категорию?')) return;
      try {
        await AdminAPI.req(`/categories/${encodeURIComponent(btn.dataset.delCat)}`, { method: 'DELETE' });
        await loadAll();
        show('categories');
      } catch (e) {
        alert(e.message);
      }
    };
  });
}

function updateAdminExecutorsDatalist() {
  const names = new Set();
  refs.contractors.forEach((c) => {
    if (c.executor?.trim()) names.add(c.executor.trim());
  });
  violations.forEach((v) => {
    if (v.responsible?.trim()) names.add(v.responsible.trim());
  });
  const el = $('#admin-executors-list');
  if (!el) return;
  el.innerHTML = [...names]
    .sort((a, b) => a.localeCompare(b, 'ru'))
    .map((n) => `<option value="${escapeHtml(n)}"></option>`)
    .join('');
}

function contractorMatchesUser(contractor, user) {
  if (!contractor || !user) return false;
  if (user.contractorId && user.contractorId === contractor.id) return true;
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[«»"""']/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^(ооо|ао|ип|зао|пао|оао)\s+/i, '')
      .trim();
  const company = norm(user.company);
  const name = norm(contractor.name);
  if (!company || !name) return false;
  return company === name || name.includes(company) || company.includes(name);
}

const HEAD_TITLE_PATTERN =
  /(?:генеральный\s+)?директор|начальник|руководитель|управляющ|ген\.?\s*директор|ceo|director|head/i;

function isCompanyHeadUser(u) {
  const t = String(u?.jobTitle || '').trim();
  return t ? HEAD_TITLE_PATTERN.test(t) : false;
}

function userActPersonNameAdmin(u) {
  if (!u) return '—';
  let ln = String(u.lastName || '').trim();
  let fn = String(u.firstName || '').trim();
  let mn = String(u.middleName || u.patronymic || '').trim();

  if (ln.includes(' ') && fn && !mn) {
    const bits = ln.split(/\s+/).filter(Boolean);
    mn = bits.slice(0, -1).join(' ');
    ln = bits[bits.length - 1] || ln;
  }
  if (fn.includes(' ') && !ln) {
    const bits = fn.split(/\s+/).filter(Boolean);
    ln = bits[0] || '';
    fn = bits[1] || '';
    mn = bits.slice(2).join(' ') || mn;
  }
  if (/\s/.test(ln) && fn && !mn) {
    const bits = ln.split(/\s+/).filter(Boolean);
    if (bits.length >= 2) {
      mn = bits.slice(0, -1).join(' ');
      ln = bits[bits.length - 1];
    }
  }

  if (ln && fn && !/\s/.test(ln)) {
    const i1 = fn.charAt(0).toUpperCase();
    if (mn) return `${ln} ${i1}.${mn.charAt(0).toUpperCase()}.`;
    return `${ln} ${i1}.`;
  }
  const name = `${fn} ${ln}`.trim();
  return name || u.email || '—';
}

function memberInitials(u) {
  const name = userActPersonNameAdmin(u);
  const bits = name.replace(/\./g, ' ').split(/\s+/).filter(Boolean);
  if (bits.length >= 2) return (bits[0][0] + bits[1][0]).toUpperCase();
  return (name[0] || '?').toUpperCase();
}

let selectedMemberId = null;

function sortMembersHeadFirst(users) {
  return [...users].sort((a, b) => {
    const ah = isCompanyHeadUser(a);
    const bh = isCompanyHeadUser(b);
    if (ah !== bh) return ah ? -1 : 1;
    return userActPersonNameAdmin(a).localeCompare(userActPersonNameAdmin(b), 'ru');
  });
}

function usersLinkableToContractor(contractorId) {
  return appUsers.filter((u) => {
    const st = String(u.status || 'active').toLowerCase();
    if (st === 'rejected') return false;
    if (u.contractorId === contractorId) return false;
    return true;
  });
}

function objectsForContractor(contractorId) {
  const ids = new Set();
  violations.forEach((v) => {
    if (v.contractorId === contractorId && v.objectId) ids.add(v.objectId);
  });
  return [...ids]
    .map((id) => refs.objects.find((o) => o.id === id))
    .filter(Boolean);
}

let selectedContractorId = null;
let editingContractorId = null;

function resetContractorToolbar() {
  editingContractorId = null;
  $('#con-name').value = '';
  $('#con-inn').value = '';
  $('#con-executor').value = '';
  $('#con-email').value = '';
  const btn = $('#btn-add-con');
  if (btn) btn.textContent = '+ Добавить';
}

function startEditContractorAdmin(c) {
  editingContractorId = c.id;
  $('#con-name').value = c.name || '';
  $('#con-inn').value = c.inn || '';
  $('#con-executor').value = c.executor || '';
  $('#con-email').value = c.email || '';
  const btn = $('#btn-add-con');
  if (btn) btn.textContent = 'Сохранить';
  document.querySelector('#page-contractors .org-toolbar')?.scrollIntoView({ behavior: 'smooth' });
}

function objectNamesForUser(u) {
  const ids = Array.isArray(u.objectIds) ? u.objectIds : [];
  if (!ids.length) return 'Все объекты организации';
  return ids
    .map((id) => refs.objects.find((o) => o.id === id)?.name || id)
    .join(', ');
}

function fillObjectMultiSelect(el, selectedIds) {
  if (!el) return;
  const selected = new Set((selectedIds || []).map(String));
  el.innerHTML = refs.objects
    .map((o) => {
      const on = selected.has(String(o.id));
      return `<label class="object-chip"><input type="checkbox" value="${escapeHtml(o.id)}" ${on ? 'checked' : ''}><span>${escapeHtml(o.name)}</span></label>`;
    })
    .join('');
}

function getSelectedObjectIds(container) {
  if (!container) return [];
  return [...container.querySelectorAll('input[type="checkbox"]:checked')].map((inp) => inp.value);
}

function renderMemberRow(u, contractor, selectedId) {
  const name = userActPersonNameAdmin(u);
  const isHead = isCompanyHeadUser(u);
  const objectLine = objectNamesForUser(u);
  const selected = u.id === selectedId;
  const meta = [u.email, u.phone, objectLine !== 'Все объекты организации' ? objectLine : '']
    .filter(Boolean)
    .join(' · ');
  return `<button type="button" class="org-staff-row${isHead ? ' org-staff-row--head' : ''}${selected ? ' org-staff-row--active' : ''}" data-select-member="${u.id}">
    <span class="org-staff-row__avatar" aria-hidden="true">${escapeHtml(memberInitials(u))}</span>
    <span class="org-staff-row__main">
      <span class="org-staff-row__top">
        <span class="org-staff-row__name">${escapeHtml(name)}</span>
        ${isHead ? '<span class="org-staff-row__badge">Начальник</span>' : ''}
        ${u.jobTitle && !isHead ? `<span class="org-staff-row__role">${escapeHtml(u.jobTitle)}</span>` : ''}
      </span>
      <span class="org-staff-row__meta">${escapeHtml(meta)}</span>
    </span>
    <span class="org-staff-row__chev" aria-hidden="true">›</span>
  </button>`;
}

function closeMemberDetail() {
  selectedMemberId = null;
  $('#member-detail-panel')?.classList.add('hidden');
  $('#member-profile-form')?.classList.add('hidden');
  $$('.org-staff-row--active').forEach((el) => el.classList.remove('org-staff-row--active'));
}

function showMemberDetail(userId, contractorId) {
  const u = appUsers.find((x) => x.id === userId);
  const contractor = refs.contractors.find((c) => c.id === contractorId);
  if (!u || !contractor) return;

  selectedMemberId = userId;
  const panel = $('#member-detail-panel');
  const nameEl = $('#member-detail-name');
  const metaEl = $('#member-detail-meta');
  if (!panel || !nameEl || !metaEl) return;

  nameEl.textContent = userActPersonNameAdmin(u);
  const metaParts = [];
  if (isCompanyHeadUser(u)) metaParts.push('Начальник организации');
  if (u.jobTitle) metaParts.push(u.jobTitle);
  metaParts.push(u.email);
  if (u.phone) metaParts.push(u.phone);
  metaEl.textContent = metaParts.join(' · ');

  fillObjectMultiSelect($('#member-detail-objects'), u.objectIds);
  $('#member-edit-first').value = u.firstName || '';
  $('#member-edit-last').value = u.lastName || '';
  $('#member-edit-job-title').value = u.jobTitle || '';
  $('#member-edit-phone').value = u.phone || '';
  $('#member-profile-form')?.classList.add('hidden');

  panel.classList.remove('hidden');
  animateIn(panel, 'detail-enter');
  $$('[data-select-member]').forEach((btn) => {
    btn.classList.toggle('org-staff-row--active', btn.dataset.selectMember === userId);
  });
}

async function saveMemberDetail(contractorId) {
  if (!selectedMemberId) return;
  const objectIds = getSelectedObjectIds($('#member-detail-objects'));
  const profileOpen = !$('#member-profile-form')?.classList.contains('hidden');
  const body = { objectIds };
  if (profileOpen) {
    body.firstName = $('#member-edit-first')?.value.trim() || '';
    body.lastName = $('#member-edit-last')?.value.trim() || '';
    body.jobTitle = $('#member-edit-job-title')?.value.trim() || '';
    body.phone = $('#member-edit-phone')?.value.trim() || '';
  }
  await AdminAPI.req(`/users/${selectedMemberId}`, { method: 'PATCH', body: JSON.stringify(body) });
  await loadUsers();
  showContractorUsers(contractorId);
  showMemberDetail(selectedMemberId, contractorId);
  const msg = $('#contractor-member-msg');
  if (msg) msg.textContent = 'Сохранено';
}

async function unlinkSelectedMember(contractorId) {
  if (!selectedMemberId) return;
  const u = appUsers.find((x) => x.id === selectedMemberId);
  const name = u ? userActPersonNameAdmin(u) : selectedMemberId;
  if (!confirm(`Отвязать «${name}» от организации?`)) return;
  await AdminAPI.req(`/users/${selectedMemberId}`, {
    method: 'PATCH',
    body: JSON.stringify({ contractorId: null, company: '', objectIds: [] }),
  });
  selectedMemberId = null;
  await loadUsers();
  showContractorUsers(contractorId);
  const msg = $('#contractor-member-msg');
  if (msg) msg.textContent = 'Сотрудник отвязан';
}

function wireMemberListActions(contractorId) {
  $$('[data-select-member]').forEach((btn) => {
    btn.onclick = () => showMemberDetail(btn.dataset.selectMember, contractorId);
  });
  const closeBtn = $('#btn-close-member-detail');
  if (closeBtn) closeBtn.onclick = closeMemberDetail;
  const saveBtn = $('#btn-save-member-detail');
  if (saveBtn) {
    saveBtn.onclick = () => saveMemberDetail(contractorId).catch((e) => alert(e.message));
  }
  const unlinkBtn = $('#btn-unlink-selected-member');
  if (unlinkBtn) {
    unlinkBtn.onclick = () => unlinkSelectedMember(contractorId).catch((e) => alert(e.message));
  }
  const profileBtn = $('#btn-toggle-member-profile');
  if (profileBtn) {
    profileBtn.onclick = () => {
      $('#member-profile-form')?.classList.toggle('hidden');
    };
  }
}

function toggleAssignPanel() {
  const panel = $('#contractor-assign-panel');
  const btn = $('#btn-toggle-assign');
  if (!panel) return;
  const hidden = panel.classList.toggle('hidden');
  panel.classList.toggle('assign-section--collapsed', hidden);
  if (btn) btn.textContent = hidden ? '+ Добавить сотрудника' : 'Скрыть форму';
}

function mountAssignUserPicker(contractorId) {
  const el = $('#assign-user-picker');
  if (!el || !window.VCUserPicker) return;
  window.VCUserPicker.mount(el, {
    users: usersLinkableToContractor(contractorId),
    variant: 'combo',
    placeholder: 'Имя или email, Enter — выбрать',
    emptyHint: 'Нет свободных сотрудников для привязки',
  });
}

async function assignUserToContractor(contractorId) {
  const picker = $('#assign-user-picker');
  let userIds = window.VCUserPicker?.getSelected(picker) || [];
  if (!userIds.length) {
    const q = picker?.querySelector('.user-picker-search')?.value?.trim().toLowerCase() || '';
    if (q.includes('@')) {
      const u = appUsers.find((x) => String(x.email || '').toLowerCase() === q);
      if (u) userIds = [u.id];
    }
    if (!userIds.length && q) {
      const hit = usersLinkableToContractor(contractorId).find((u) => {
        const hay = [u.firstName, u.lastName, u.name, u.email, u.company, u.phone]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
      if (hit) userIds = [hit.id];
    }
  }
  if (!userIds.length) {
    alert('Выберите сотрудника из списка (введите email и нажмите Enter)');
    return;
  }
  const objectIds = getSelectedObjectIds($('#assign-object-chips'));
  await AdminAPI.req(`/contractors/${contractorId}/members`, {
    method: 'POST',
    body: JSON.stringify({ userIds, objectIds }),
  });
  await loadUsers();
  showContractorUsers(contractorId);
  const msg = $('#contractor-member-msg');
  if (msg) msg.textContent = `Привязано сотрудников: ${userIds.length}`;
}

async function createMemberForContractor(contractorId) {
  const email = $('#new-member-email')?.value.trim();
  const firstName = $('#new-member-first')?.value.trim();
  const lastName = $('#new-member-last')?.value.trim();
  const phone = $('#new-member-phone')?.value.trim();
  const jobTitle = $('#new-member-job-title')?.value.trim() || '';
  const objectIds = getSelectedObjectIds($('#new-member-object-chips'));
  if (!email || !firstName) {
    alert('Укажите email и имя');
    return;
  }
  const data = await AdminAPI.req(`/contractors/${contractorId}/members`, {
    method: 'POST',
    body: JSON.stringify({ email, firstName, lastName, phone, jobTitle, objectIds, role: 'contractor' }),
  });
  await loadUsers();
  showContractorUsers(contractorId);
  const msg = $('#contractor-member-msg');
  if (msg) {
    msg.textContent = data.linked
      ? 'Существующий пользователь привязан к организации'
      : data.tempPassword
        ? `Сотрудник создан. Временный пароль: ${data.tempPassword}`
        : 'Сотрудник создан и привязан';
  }
  $('#new-member-email').value = '';
  $('#new-member-first').value = '';
  $('#new-member-last').value = '';
  $('#new-member-phone').value = '';
  if ($('#new-member-job-title')) $('#new-member-job-title').value = '';
}

function showContractorUsers(contractorId) {
  const contractor = refs.contractors.find((c) => c.id === contractorId);
  const panel = $('#contractor-linked-panel');
  const listEl = $('#contractor-linked-users');
  const titleEl = $('#contractor-linked-title');
  const hintEl = $('#contractor-linked-hint');
  if (!contractor || !panel || !listEl) return;

  selectedContractorId = contractorId;
  $$('.contractor-row-link').forEach((row) => {
    row.classList.toggle('row-active', row.dataset.conId === contractorId);
  });

  const objects = objectsForContractor(contractor.id);
  const linked = sortMembersHeadFirst(appUsers.filter((u) => contractorMatchesUser(contractor, u)));

  titleEl.textContent = contractor.name;
  hintEl.textContent = objects.length
    ? `Объекты: ${objects.map((o) => o.name).join(', ')}`
    : 'Назначьте объекты сотрудникам при необходимости';

  const countEl = $('#contractor-member-count');
  if (countEl) {
    countEl.textContent = linked.length
      ? `${linked.length} ${linked.length === 1 ? 'сотрудник' : linked.length < 5 ? 'сотрудника' : 'сотрудников'}`
      : 'Нет сотрудников';
  }

  const keepSelection = selectedMemberId && linked.some((u) => u.id === selectedMemberId);

  if (!linked.length) {
    listEl.innerHTML = '<p class="org-staff-empty">Нет сотрудников. Нажмите «+ Добавить сотрудника».</p>';
    closeMemberDetail();
  } else {
    listEl.innerHTML = linked.map((u) => renderMemberRow(u, contractor, keepSelection ? selectedMemberId : null)).join('');
    wireMemberListActions(contractorId);
    if (keepSelection) {
      showMemberDetail(selectedMemberId, contractorId);
    } else {
      closeMemberDetail();
      if (linked.length === 1) showMemberDetail(linked[0].id, contractorId);
    }
  }

  panel.classList.remove('hidden');
  animateIn(panel, 'panel-enter');
  $('#contractor-assign-panel')?.classList.add('hidden', 'assign-section--collapsed');
  if ($('#btn-toggle-assign')) {
    $('#btn-toggle-assign').textContent = '+ Добавить сотрудника';
    $('#btn-toggle-assign').onclick = toggleAssignPanel;
  }
  wireAssignTabs();
  mountAssignUserPicker(contractorId);
  if (panel.dataset.contractorId !== contractorId) {
    window.VCUserPicker?.clear($('#assign-user-picker'));
    panel.dataset.contractorId = contractorId;
  }
  fillObjectMultiSelect($('#assign-object-chips'), []);
  fillObjectMultiSelect($('#new-member-object-chips'), []);
  $('#btn-assign-user').onclick = () =>
    assignUserToContractor(contractorId).catch((e) => alert(e.message));
  $('#btn-create-member').onclick = () =>
    createMemberForContractor(contractorId).catch((e) => alert(e.message));
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const ORG_ROW_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="13" rx="1"/><path d="M8 8V5h8v3"/><path d="M8 13h.01M12 13h.01M16 13h.01"/><path d="M8 17h.01M12 17h.01M16 17h.01"/></svg>';

function renderContractorsTable() {
  updateAdminExecutorsDatalist();
  $('#contractors-table tbody').innerHTML = refs.contractors
    .map((c) => {
      const active = selectedContractorId === c.id ? ' row-active' : '';
      const emailCell = c.email
        ? `<a href="mailto:${encodeURIComponent(c.email)}" class="org-email-link">${escapeHtml(c.email)}</a>`
        : '—';
      return `<tr class="org-row contractor-row-link${active}" data-con-id="${c.id}">
      <td class="org-name-cell">
        <span class="org-row-ico" aria-hidden="true">${ORG_ROW_ICON}</span>
        <span class="org-name">${escapeHtml(c.name)}</span>
      </td>
      <td>${escapeHtml(c.inn || '—')}</td>
      <td>${escapeHtml(c.executor || '—')}</td>
      <td>${emailCell}</td>
      <td class="org-actions-cell">
        <button type="button" class="org-edit-btn" data-edit-con="${escapeHtml(c.id)}">Изменить</button>
        <button type="button" class="org-del-btn" data-del-con="${escapeHtml(c.id)}">Удалить</button>
      </td>
    </tr>`;
    })
    .join('');
  $$('.contractor-row-link').forEach((row) => {
    row.onclick = (e) => {
      if (e.target.closest('[data-del-con]') || e.target.closest('[data-edit-con]')) return;
      showContractorUsers(row.dataset.conId);
    };
  });
  $$('[data-edit-con]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const c = refs.contractors.find((x) => x.id === btn.dataset.editCon);
      if (c) startEditContractorAdmin(c);
    };
  });
  $$('[data-del-con]').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('Удалить организацию?')) return;
      try {
        await AdminAPI.req(`/contractors/${btn.dataset.delCon}`, { method: 'DELETE' });
        await loadAll();
      } catch (e) {
        alert(e.message);
      }
    };
  });
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function renderDashboard(a) {
  $('#kpi-total').textContent = a.total;
  $('#kpi-resolved').textContent = `${a.resolvedPct}%`;
  $('#kpi-overdue').textContent = a.overdue;
  $('#kpi-critical').textContent = a.critical;

  const maxCat = Math.max(...a.byCategory.map((x) => x.count), 1);
  $('#chart-categories').innerHTML = a.byCategory
    .map(
      (c) => `
    <div class="bar-row">
      <span style="width:140px">${c.name}</span>
      <div class="track"><div class="fill" style="width:${(c.count / maxCat) * 100}%"></div></div>
      <span>${c.count}</span>
    </div>`
    )
    .join('');

  const maxOrg = Math.max(...a.topOrganizations.map((x) => x.count), 1);
  $('#chart-orgs').innerHTML = a.topOrganizations
    .map(
      (o) => `
    <div class="bar-row">
      <span style="width:140px">${o.name}</span>
      <div class="track"><div class="fill" style="width:${(o.count / maxOrg) * 100}%"></div></div>
      <span>${o.count}</span>
    </div>`
    )
    .join('');

  $('#recent-table tbody').innerHTML = a.recent
    .map((v) => {
      const obj = refs.objects.find((o) => o.id === v.objectId)?.name || '—';
      return `<tr>
        <td><strong>${v.number}</strong></td>
        <td>${obj}</td>
        <td>${v.description.slice(0, 50)}${v.description.length > 50 ? '…' : ''}</td>
        <td><span class="badge ${v.status}">${statusLabel(v.status)}</span></td>
      </tr>`;
    })
    .join('');
}

function statusLabel(s) {
  const m = {
    new: 'Открыто',
    in_progress: 'В работе',
    verification: 'На проверке',
    resolved: 'Устранено',
    overdue: 'Просрочено',
  };
  return m[s] || s;
}

function categoryIconHtml(v, cat) {
  const iconKey = String(cat?.icon || '').trim();
  if (window.VCIcons) {
    let name = VCIcons.categoryIconId(v.categoryId);
    if (iconKey.startsWith('ic-')) {
      const mapped = iconKey.replace(/^ic-/, '');
      if (mapped) name = mapped;
    }
    return VCIcons.svg(name, { size: 18 });
  }
  if (iconKey.startsWith('ic-')) {
    return `<img src="/mobile/assets/icons-categories/${escapeHtml(iconKey)}.png" alt="">`;
  }
  return escapeHtml(iconKey || '📋');
}

function populateViolObjectFilter() {
  const sel = $('#viol-filter-object');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML =
    '<option value="">Все объекты</option>' +
    refs.objects
      .map((o) => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.name)}</option>`)
      .join('');
  if (cur) sel.value = cur;
}

function getFilteredViolations() {
  const filter = $('#filter-status')?.value || 'all';
  const search = ($('#filter-search')?.value || '').toLowerCase();
  const objectId = $('#viol-filter-object')?.value || '';
  let items = [...violations];
  items = items.filter((v) => violMatchesFilter(v, filter));
  if (objectId) items = items.filter((v) => v.objectId === objectId);
  if (search) {
    items = items.filter((v) => {
      const obj = refs.objects.find((o) => o.id === v.objectId)?.name || '';
      return (
        v.number.toLowerCase().includes(search) ||
        v.description.toLowerCase().includes(search) ||
        (v.responsible || '').toLowerCase().includes(search) ||
        obj.toLowerCase().includes(search)
      );
    });
  }
  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return items;
}

function buildViolPageList(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const list = [1];
  if (current > 3) list.push('…');
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) list.push(i);
  if (current < total - 2) list.push('…');
  list.push(total);
  return list;
}

function renderViolPagination(total) {
  const nav = $('#viol-page-nav');
  const info = $('#viol-page-info');
  if (!nav || !info) return;

  if (!total) {
    info.textContent = 'Нет записей';
    nav.innerHTML = '';
    return;
  }

  const pages = Math.max(1, Math.ceil(total / VIOL_PAGE_SIZE));
  violPage = Math.min(violPage, pages);
  violPage = Math.max(violPage, 1);
  const start = (violPage - 1) * VIOL_PAGE_SIZE;
  const end = Math.min(start + VIOL_PAGE_SIZE, total);
  info.textContent = `${violPage} из ${pages} ${pages === 1 ? 'страница' : 'страниц'}`;

  if (pages <= 1) {
    nav.innerHTML = '';
    return;
  }

  const parts = [];
  parts.push(
    `<button type="button" class="viol-page-btn" data-page="${violPage - 1}" ${violPage <= 1 ? 'disabled' : ''} aria-label="Предыдущая">‹</button>`
  );
  buildViolPageList(violPage, pages).forEach((p) => {
    if (p === '…') {
      parts.push('<span class="viol-page-ellipsis">…</span>');
      return;
    }
    parts.push(
      `<button type="button" class="viol-page-btn${p === violPage ? ' active' : ''}" data-page="${p}">${p}</button>`
    );
  });
  parts.push(
    `<button type="button" class="viol-page-btn" data-page="${violPage + 1}" ${violPage >= pages ? 'disabled' : ''} aria-label="Следующая">›</button>`
  );
  nav.innerHTML = parts.join('');
  nav.querySelectorAll('[data-page]').forEach((btn) => {
    btn.onclick = () => {
      const p = Number(btn.dataset.page);
      if (!Number.isFinite(p) || p < 1 || p > pages || btn.disabled) return;
      violPage = p;
      renderViolationsTable();
    };
  });
}

function exportViolationsCsv() {
  const items = getFilteredViolations();
  const header = ['№', 'Объект', 'Категория', 'Описание', 'Ответственный', 'Срок', 'Статус'];
  const rows = items.map((v) => {
    const obj = refs.objects.find((o) => o.id === v.objectId)?.name || '';
    const cat = categoryForViolation(v);
    const st = effectiveViolStatus(v);
    const deadline = v.deadline ? new Date(v.deadline).toLocaleDateString('ru-RU') : '';
    return [v.number, obj, cat.name, v.description, v.responsible || '', deadline, statusLabel(st)];
  });
  const lines = [header, ...rows].map((r) =>
    r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')
  );
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `violations-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function renderViolationsTable() {
  const items = getFilteredViolations();
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / VIOL_PAGE_SIZE));
  violPage = Math.min(Math.max(violPage, 1), pages);
  const start = (violPage - 1) * VIOL_PAGE_SIZE;
  const pageItems = items.slice(start, start + VIOL_PAGE_SIZE);

  const countEl = $('#viol-count');
  if (countEl) {
    const objCount = refs.objects.length;
    countEl.textContent = `${violations.length} записей · ${objCount} объектов`;
  }

  $('#violations-table tbody').innerHTML = pageItems.length
    ? pageItems
    .map((v) => {
      const obj = refs.objects.find((o) => o.id === v.objectId)?.name || '—';
          const cat = categoryForViolation(v);
          const st = effectiveViolStatus(v);
          const iconHtml = categoryIconHtml(v, cat);
          const training = String(v.description || '').includes('[TRAINING');
          const trainingBadge = training ? ' <span class="badge training">Учебный</span>' : '';
          return `<tr data-viol-id="${v.id}">
        <td><span class="viol-num">${escapeHtml(v.number)}</span>${trainingBadge}</td>
        <td>
          <div class="viol-cell-main">
            <div class="viol-cat-ico">${iconHtml}</div>
            <div>
              <div class="viol-title">${escapeHtml(v.description.slice(0, 80))}${v.description.length > 80 ? '…' : ''}</div>
              <div class="viol-cat-label">${escapeHtml(cat.name)}</div>
            </div>
          </div>
        </td>
        <td>${escapeHtml(obj)}</td>
        <td>${escapeHtml(v.responsible || '—')}</td>
        <td>${formatViolDeadline(v)}</td>
        <td><span class="badge ${st}">${statusLabel(st)}</span></td>
      </tr>`;
    })
        .join('')
    : `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:40px 16px">Нарушений не найдено</td></tr>`;

  renderViolPagination(total);

  $$('#violations-table tbody tr[data-viol-id]').forEach((row) => {
    row.onclick = (e) => {
      if (e.target.closest('a, button, select')) return;
      showViolationDetail(row.dataset.violId);
    };
  });
}

function setBootStatus(text, isError = false) {
  let el = document.getElementById('admin-boot-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'admin-boot-status';
    el.style.cssText =
      'position:fixed;right:12px;bottom:12px;z-index:99999;padding:8px 10px;border-radius:8px;font-size:12px;background:rgba(15,20,25,.92);color:#e5e7eb;border:1px solid rgba(255,255,255,.12)';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.borderColor = isError ? '#ef4444' : 'rgba(255,255,255,.12)';
  el.style.color = isError ? '#fecaca' : '#e5e7eb';
}

window.addEventListener('error', (event) => {
  setBootStatus(`JS ошибка: ${event.message || 'unknown'}`, true);
});

window.addEventListener('unhandledrejection', (event) => {
  const msg = event?.reason?.message || String(event?.reason || 'unhandled rejection');
  setBootStatus(`Promise ошибка: ${msg}`, true);
});

async function boot() {
  setBootStatus('admin.js загружен');
  applyTokenFromUrl();
  updateMobileLink();
  $('#login-form').onsubmit = login;
  $('#btn-logout').onclick = logout;
  $('#btn-logout-sidebar')?.addEventListener('click', logout);
  $('#viol-detail-back')?.addEventListener('click', showViolationList);
  initPhotoLightbox();

  $$('.viol-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.viol-tab').forEach((t) => t.classList.toggle('active', t === tab));
      const val = tab.dataset.violFilter || 'all';
      const hidden = $('#filter-status');
      if (hidden) hidden.value = val;
      violPage = 1;
      renderViolationsTable();
    });
  });

  $('#filter-search')?.addEventListener('input', () => {
    violPage = 1;
    renderViolationsTable();
  });
  $('#viol-filter-object')?.addEventListener('change', () => {
    violPage = 1;
    renderViolationsTable();
  });
  $('#viol-filters-btn')?.addEventListener('click', () => {
    $('#viol-advanced')?.classList.toggle('hidden');
  });
  $('#viol-btn-export')?.addEventListener('click', exportViolationsCsv);
  $('#viol-btn-add')?.addEventListener('click', () => {
    const token = AdminAPI.token();
    window.open(token ? `/mobile/?token=${encodeURIComponent(token)}` : '/mobile/', '_blank');
  });

  document.querySelectorAll('[data-theme-btn]').forEach((btn) => {
    btn.addEventListener('click', () => VCTheme.apply(btn.dataset.themeBtn));
  });

  $('#btn-add-obj').onclick = async () => {
    try {
      await AdminAPI.req('/objects', {
        method: 'POST',
        body: JSON.stringify({
          name: $('#obj-name').value.trim(),
          code: $('#obj-code').value.trim(),
          address: $('#obj-address').value.trim(),
        }),
      });
      $('#obj-name').value = '';
      $('#obj-code').value = '';
      $('#obj-address').value = '';
      await loadAll();
      show('objects');
    } catch (e) {
      alert(e.message);
    }
  };

  $('#btn-add-cat').onclick = async () => {
    try {
      const name = $('#cat-name').value.trim();
      const icon = 'ic-other';
      if (!name) {
        alert('Укажите название категории');
        return;
      }
      await AdminAPI.req('/categories', {
        method: 'POST',
        body: JSON.stringify({ name, icon }),
      });
      $('#cat-name').value = '';
      await loadAll();
      show('categories');
    } catch (e) {
      alert(e.message);
    }
  };

  $('#btn-add-con').onclick = async () => {
    try {
      const payload = {
          name: $('#con-name').value.trim(),
          inn: $('#con-inn').value.trim(),
          executor: $('#con-executor').value.trim(),
          email: $('#con-email').value.trim(),
      };
      if (!payload.name) {
        alert('Укажите название организации');
        return;
      }
      if (editingContractorId) {
        await AdminAPI.req(`/contractors/${editingContractorId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        resetContractorToolbar();
      } else {
        await AdminAPI.req('/contractors', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        resetContractorToolbar();
      }
      await loadAll();
      show('contractors');
    } catch (e) {
      alert(e.message);
    }
  };

  $('#btn-refresh-users')?.addEventListener('click', () => {
    loadUsers().catch((e) => alert(e.message));
  });

  $('#user-edit-save')?.addEventListener('click', () => saveUserEdit());
  $$('[data-close-user-edit]').forEach((el) => {
    el.addEventListener('click', closeUserEdit);
  });

  $$('.nav-btn[data-page]').forEach((btn) => {
    btn.onclick = () => show(btn.dataset.page);
  });

  $('#btn-mark-all-read')?.addEventListener('click', async () => {
    const unread = adminNotifications.filter((n) => !(n.isRead || n.read));
    if (!unread.length) {
      adminToast('Нет непрочитанных уведомлений');
      return;
    }
    try {
      await markAllNotificationsRead();
      await renderNotificationsPage();
      adminToast('Все уведомления прочитаны');
    } catch (e) {
      alert(e.message);
    }
  });

  wireAssignTabs();
  initUsersFilters();
  initNotifyFilters();

  const token = AdminAPI.token();
  if (!token) return;

  try {
    const { user } = await AdminAPI.req('/auth/me');
    if (user.role !== 'admin') throw new Error('Не admin');
    $('#user-label').textContent = user.name;
    const sn = $('#sidebar-user-name');
    const si = $('#sidebar-user-initials');
    if (sn) sn.textContent = user.name;
    if (si) si.textContent = userInitials(user.name);
    $('#login-screen').classList.add('hidden');
    $('#app-layout').classList.remove('hidden');
    activateAdminShell();
    updateMobileLink();
    await loadAll();
    show('analytics');
    setBootStatus('Админка активна');
  } catch (e) {
    if (e?.status === 401 || e?.status === 403) {
    AdminAPI.setToken(null);
      setBootStatus('Требуется вход', true);
      return;
    }
    // При временной сетевой ошибке не сбрасываем сессию.
    setBootStatus(`Ошибка связи с сервером: ${e?.message || 'неизвестно'}`, true);
  }
}

boot().catch((e) => {
  setBootStatus(`boot() ошибка: ${e?.message || e}`, true);
  console.error('[admin boot]', e);
});
