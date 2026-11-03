/**
 * Системные push на телефон: Web Notifications (PWA) и Android APK (VCAndroidNotify).
 */
(function () {
  const STORAGE_KEY = 'vc_push_seen_ids';
  let pollTimer = null;

  function loadSeen() {
    try {
      return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));
    } catch (_) {
      return new Set();
    }
  }

  function saveSeen(set) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...set].slice(-200)));
    } catch (_) {}
  }

  const seenIds = loadSeen();

  function isPushForUser(n, userId) {
    if (!n || n.channel !== 'push') return false;
    if (n.userId && userId && n.userId !== userId) return false;
    return true;
  }

  function showNative(n) {
    const title = n.title || 'Visural Audit';
    const raw = n.body || n.message || '';
    const body = String(raw).replace(/\n+/g, ' · ').trim().slice(0, 240);
    const vid = n.violationId || '';

    if (window.VCAndroidNotify && typeof window.VCAndroidNotify.show === 'function') {
      window.VCAndroidNotify.show(title, body, vid);
      return;
    }
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      const notif = new Notification(title, {
        body,
        tag: n.id || vid || 'vc-push',
        icon: 'icons/icon-192.png',
        data: { violationId: vid },
      });
      notif.onclick = function () {
        window.focus();
        notif.close();
        if (vid && typeof openDetail === 'function') openDetail(vid);
      };
    } catch (_) {}
  }

  async function ensurePermission() {
    if (window.VCAndroidNotify && typeof window.VCAndroidNotify.requestPermission === 'function') {
      return !!window.VCAndroidNotify.requestPermission();
    }
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const p = await Notification.requestPermission();
    return p === 'granted';
  }

  function permissionStatus() {
    if (window.VC_ANDROID_APP) {
      if (window.VCAndroidNotify && typeof window.VCAndroidNotify.hasPermission === 'function') {
        return window.VCAndroidNotify.hasPermission() ? 'granted' : 'default';
      }
      return 'default';
    }
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission;
  }

  function processNotifications(list, userId) {
    if (!userId || !Array.isArray(list)) return;
    let changed = false;
    list.forEach((n) => {
      if (!isPushForUser(n, userId)) return;
      if (seenIds.has(n.id)) return;
      seenIds.add(n.id);
      changed = true;
      showNative(n);
    });
    if (changed) saveSeen(seenIds);
  }

  function startPolling(fn, intervalMs) {
    stopPolling();
    pollTimer = setInterval(fn, intervalMs || 45000);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  window.VCPushNotify = {
    ensurePermission,
    permissionStatus,
    processNotifications,
    startPolling,
    stopPolling,
  };
})();
