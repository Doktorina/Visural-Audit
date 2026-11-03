const VictoryAPI = (() => {
  const TOKEN_KEY = 'vc_token';
  const SERVER_KEY = 'vc_server_url';
  const DEFAULT_SERVER = 'https://audit.visural.ru';
  const FETCH_TIMEOUT_MS = 45000;
  const AUTH_TIMEOUT_MS = 60000;
  const NETWORK_HINT =
    'Нет связи с сервером. Проверьте интернет и адрес https://audit.visural.ru';

  function formatNetworkError(e) {
    if (!e) return NETWORK_HINT;
    const msg = String(e.message || '');
    if (/load failed|failed to fetch|networkerror/i.test(msg)) {
      return NETWORK_HINT;
    }
    if (e.name === 'AbortError' || /aborted|abort/i.test(msg)) {
      return 'Сервер не ответил вовремя. Проверьте интернет и попробуйте ещё раз.';
    }
    if (/таймаут|timeout/i.test(msg)) {
      return 'Сервер не ответил вовремя. Проверьте интернет и попробуйте ещё раз.';
    }
    return msg || NETWORK_HINT;
  }

  function isAuthPath(path) {
    return /^\/auth\/(login|register|forgot-password)/.test(String(path || ''));
  }

  function safeGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function safeSet(key, val) {
    try {
      localStorage.setItem(key, val);
      return true;
    } catch (_) {
      return false;
    }
  }

  function isAppMode() {
    if (window.VC_ANDROID_APP) return true;
    const o = window.location.origin || '';
    const p = window.location.protocol || '';
    const href = window.location.href || '';
    if (p === 'file:') return true;
    if (o === 'null' || o === '') return true;
    if (o.startsWith('capacitor://') || o.startsWith('ionic://')) return true;
    if (/android_asset/i.test(href)) return true;
    if (/flutter_assets/i.test(href)) return true;
    if (window.VC_FLUTTER_APP) return true;
    if (o.includes('localhost') && (p === 'http:' || p === 'https:')) return true;
    return false;
  }

  function normalizeServer(raw) {
    let s = String(raw || '').trim().replace(/\/+$/, '');
    if (!s) return DEFAULT_SERVER;
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    s = s.replace(/^http:\/\/(audit\.visural\.ru)/i, 'https://$1');
    return s.replace(/\/api$/i, '');
  }

  function getServerUrl() {
    return normalizeServer(safeGet(SERVER_KEY) || DEFAULT_SERVER);
  }

  function setServerUrl(url) {
    const s = normalizeServer(url);
    safeSet(SERVER_KEY, s);
    window.VC_API_URL = s + '/api';
    enabled = null;
    return s;
  }

  function isLocalHost() {
    var h = (window.location.hostname || '').toLowerCase();
    return !h || h === 'localhost' || h === '127.0.0.1';
  }

  /** Страница открыта с боевого сервера (не localhost и не file://) */
  function isServerDeploy() {
    var p = window.location.protocol || '';
    if (p === 'file:') return false;
    return !isLocalHost() && (p === 'http:' || p === 'https:');
  }

  function baseUrl() {
    if (isServerDeploy()) {
      let origin = window.location.origin.replace(/\/+$/, '');
      if (/^http:\/\//i.test(origin) && !isLocalHost()) {
        origin = origin.replace(/^http:/i, 'https:');
      }
      return origin + '/api';
    }
    if (window.VC_API_URL) return String(window.VC_API_URL).replace(/\/$/, '');
    return getServerUrl() + '/api';
  }

  function httpRequest(url, options, timeoutMs) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.timeout = timeoutMs || FETCH_TIMEOUT_MS;
      const method = (options && options.method) || 'GET';
      xhr.open(method, url, true);
      const headers = (options && options.headers) || {};
      Object.keys(headers).forEach((k) => xhr.setRequestHeader(k, headers[k]));
      xhr.onload = function () {
        resolve({
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
          json: function () {
            try {
              return Promise.resolve(JSON.parse(xhr.responseText || '{}'));
            } catch (_) {
              return Promise.resolve({});
            }
          },
        });
      };
      xhr.onerror = function () {
        reject(new Error(NETWORK_HINT));
      };
      xhr.ontimeout = function () {
        const e = new Error('Таймаут');
        e.name = 'AbortError';
        reject(e);
      };
      xhr.send((options && options.body) || null);
    });
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    const opts = options || {};
    const ms = timeoutMs || FETCH_TIMEOUT_MS;
    if (typeof fetch === 'function') {
      try {
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const t = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
        const res = await fetch(url, { ...opts, signal: ctrl ? ctrl.signal : undefined });
        if (t) clearTimeout(t);
        return res;
      } catch (e) {
        try {
          return await httpRequest(url, opts, ms);
        } catch (_) {
          throw new Error(formatNetworkError(e));
        }
      }
    }
    try {
      return await httpRequest(url, opts, ms);
    } catch (e) {
      throw new Error(formatNetworkError(e));
    }
  }

  let memToken = null;

  function getToken() {
    if (memToken) return memToken;
    return safeGet(TOKEN_KEY);
  }

  function setToken(t) {
    memToken = t || null;
    if (t) safeSet(TOKEN_KEY, t);
    else {
      try {
        localStorage.removeItem(TOKEN_KEY);
      } catch (_) {}
    }
  }

  async function request(path, options) {
    const opts = options || {};
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    const timeoutMs = isAuthPath(path) ? AUTH_TIMEOUT_MS : FETCH_TIMEOUT_MS;
    let res;
    try {
      res = await fetchWithTimeout(baseUrl() + path, { ...opts, headers }, timeoutMs);
    } catch (e) {
      throw new Error(formatNetworkError(e));
    }
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401 && token) {
        const err = new Error(data.error || 'Unauthorized');
        err.status = 401;
        throw err;
      }
      throw new Error(data.error || 'Ошибка ' + res.status);
    }
    return data;
  }

  let enabled = null;

  async function check() {
    try {
      const r = await fetchWithTimeout(baseUrl() + '/health', { method: 'GET' });
      enabled = r.ok;
    } catch (_) {
      enabled = false;
    }
    return enabled;
  }

  async function testConnection() {
    const server = getServerUrl();
    try {
      const r = await fetchWithTimeout(
        baseUrl() + '/health?t=' + Date.now(),
        { method: 'GET' }
      );
      if (!r.ok) return { ok: false, message: 'Сервер ответил с ошибкой' };
      const data = await r.json();
      const ver = data.version ? ' · сервер v' + data.version : '';
      if (data.lanIp && data.lanIp !== server.replace(/^https?:\/\//, '').split(':')[0]) {
        return {
          ok: true,
          message: 'Сервер доступен' + ver + '. IP ПК: ' + data.lanIp,
          suggestedUrl: data.mobileUrl ? data.mobileUrl.replace(/\/mobile\/?$/, '') : 'http://' + data.lanIp,
        };
      }
      return { ok: true, message: 'Сервер доступен' + ver };
    } catch (e) {
      if (e.name === 'AbortError') {
        return { ok: false, message: 'Таймаут. ' + NETWORK_HINT };
      }
      return { ok: false, message: NETWORK_HINT };
    }
  }

  function getAppVersion() {
    return typeof VC_VERSION !== 'undefined' ? VC_VERSION : '1.1.3';
  }

  return {
    get enabled() {
      return enabled === true;
    },
    isAppMode,
    isLocalHost,
    isServerDeploy,
    getServerUrl,
    setServerUrl,
    check,
    getHealth: function () {
      return fetchWithTimeout(baseUrl() + '/health', { method: 'GET' }).then(function (res) {
        return res.json();
      });
    },
    testConnection,
    getAppVersion,
    getToken,
    setToken,
    login: function (email, password) {
      return request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email, password: password }),
      });
    },
    register: function (payload) {
      return request('/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    forgotPassword: function (payload) {
      return request('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    me: function () {
      return request('/auth/me');
    },
    updateProfile: function (body) {
      return request('/auth/profile', { method: 'PATCH', body: JSON.stringify(body) });
    },
    getViolations: function (params) {
      params = params || {};
      const q = new URLSearchParams(params).toString();
      return request('/violations' + (q ? '?' + q : ''));
    },
    getViolation: function (id) {
      return request('/violations/' + id);
    },
    createViolation: function (body) {
      return request('/violations', { method: 'POST', body: JSON.stringify(body) });
    },
    patchViolation: function (id, body) {
      return request('/violations/' + id, { method: 'PATCH', body: JSON.stringify(body) });
    },
    deleteViolation: function (id) {
      return request('/violations/' + id, { method: 'DELETE' });
    },
    getObjects: function () {
      return request('/objects');
    },
    getContractors: function () {
      return request('/contractors');
    },
    getContractorMembers: function (contractorId, objectId) {
      const q = objectId ? '?objectId=' + encodeURIComponent(objectId) : '';
      return request('/contractors/' + contractorId + '/members' + q);
    },
    getCategories: function () {
      return request('/categories');
    },
    getAnalytics: function () {
      return request('/analytics');
    },
    getNotifications: function () {
      return request('/notifications');
    },
    requestApproval: function () {
      return request('/auth/request-approval', { method: 'POST', body: '{}' });
    },
    ensureContractorTrainingTicket: function () {
      return request('/onboarding/contractor-ticket', { method: 'POST', body: '{}' });
    },
    cleanupTrainingTickets: function () {
      return request('/onboarding/cleanup', { method: 'POST', body: '{}' });
    },
    getViolationNotifications: function (id, params) {
      params = params || {};
      const q = new URLSearchParams(params).toString();
      return request('/violations/' + id + '/notifications' + (q ? '?' + q : ''));
    },
    sendViolationEmail: function (id, body) {
      return request('/violations/' + id + '/send-email', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    getNotificationSettings: function () {
      return request('/notification-settings');
    },
    patchNotificationSettings: function (body) {
      return request('/notification-settings', { method: 'PATCH', body: JSON.stringify(body) });
    },
    getGoogleAuthUrl: function () {
      return request('/auth/google/url');
    },
    disconnectGoogle: function () {
      return request('/auth/google', { method: 'DELETE' });
    },
    getTelegramInfo: function () {
      return request('/telegram/info');
    },
    syncTelegram: function () {
      return request('/telegram/sync', { method: 'POST', body: '{}' });
    },
    getTelegramHistory: function () {
      return request('/telegram/history');
    },
    searchOrganizations: function (q) {
      var qs = q ? '?q=' + encodeURIComponent(String(q).trim()) : '';
      return request('/public/organizations' + qs);
    },
    createObject: function (body) {
      return request('/objects', { method: 'POST', body: JSON.stringify(body) });
    },
    deleteObject: function (id) {
      return request('/objects/' + id, { method: 'DELETE' });
    },
    createContractor: function (body) {
      return request('/contractors', { method: 'POST', body: JSON.stringify(body) });
    },
    patchContractor: function (id, body) {
      return request('/contractors/' + id, { method: 'PATCH', body: JSON.stringify(body) });
    },
    deleteContractor: function (id) {
      return request('/contractors/' + id, { method: 'DELETE' });
    },
  };
})();

if (typeof window !== 'undefined') {
  window.VictoryAPI = VictoryAPI;
}
