const VCHistory = (() => {
  const state = { inited: false, loading: false, violations: [], refs: { objects: [], contractors: [], categories: [] } };

  const $ = (s) => document.querySelector(s);
  const esc = (v) => {
    const d = document.createElement('div');
    d.textContent = String(v ?? '');
    return d.innerHTML;
  };

  const ICONS = {
    created:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    resolved:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>',
    assigned:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0114 0"/></svg>',
    comment:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M5 5h14a2 2 0 012 2v9a2 2 0 01-2 2H9l-4 3V7a2 2 0 012-2Z"/></svg>',
    overdue:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    system:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="12" cy="12" r="2"/></svg>',
  };

  function classifyEvent(text, kind) {
    if (kind === 'comment') return 'comment';
    const t = String(text || '').toLowerCase();
    if (/создан|зафиксирован/.test(t)) return 'created';
    if (/срок устранения истёк|просроч/.test(t)) return 'overdue';
    if (/устранен|устранено|resolved|принят|отчёт/.test(t)) return 'resolved';
    if (/ответственн|назначен/.test(t)) return 'assigned';
    return 'system';
  }

  function shortDesc(text, max = 36) {
    const s = String(text || '').trim();
    if (!s) return '—';
    return s.length > max ? `${s.slice(0, max)}…` : s;
  }

  function flattenEvents(violations, refs) {
    const events = [];
    for (const v of violations) {
      const obj = refs.objects?.find((o) => o.id === v.objectId)?.name || '—';
      const number = v.number || '—';
      const desc = v.description || '';
      const base = { violationId: v.id, number, desc, obj, responsible: v.responsible || '' };

      (Array.isArray(v.history) ? v.history : []).forEach((h) => {
        if (!h?.at) return;
        if (/осталось менее|уведомление на почту/i.test(h.text || '') && !/истёк/i.test(h.text || '')) return;
        events.push({
          ...base,
          at: h.at,
          text: h.text || '',
          by: h.by || '',
          type: classifyEvent(h.text, 'history'),
        });
      });

      (Array.isArray(v.comments) ? v.comments : []).forEach((c) => {
        if (!c?.at) return;
        events.push({
          ...base,
          at: c.at,
          text: c.text || '',
          by: c.by || '',
          type: 'comment',
        });
      });
    }
    events.sort((a, b) => new Date(b.at) - new Date(a.at));
    return events;
  }

  function eventTitle(e) {
    const quoted = `«${shortDesc(e.desc, 32)}»`;
    if (e.type === 'assigned') {
      const who = e.text.includes('—')
        ? e.text.split('—').slice(1).join('—').trim()
        : e.responsible || e.by || '—';
      return `Назначен ответственный — ${who} · ${e.number}`;
    }
    if (e.type === 'comment') return 'Комментарий подрядчика';
    if (e.type === 'created') return `Создано · ${e.number} ${quoted}`;
    if (e.type === 'resolved') return `Устранено · ${e.number} ${quoted}`;
    if (e.type === 'overdue') return `Срок устранения истёк · ${e.number}`;
    return `${e.text || 'Событие'} · ${e.number}`;
  }

  function eventMeta(e) {
    if (e.type === 'comment') {
      const quote = e.text ? `«${shortDesc(e.text, 48)}»` : '';
      const who = e.by || e.responsible || '—';
      return quote ? `${quote} · ${who}` : `${e.obj} · ${who}`;
    }
    const who = e.by || e.responsible || '—';
    return `${e.obj} · ${who}`;
  }

  function formatDateLabel(iso) {
    try {
      return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (_) {
      return '—';
    }
  }

  function formatTime(iso) {
    try {
      return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return '—';
    }
  }

  function getFilter() {
    return document.querySelector('.hist-tab.active')?.dataset.histFilter || 'all';
  }

  function filterEvents(events) {
    const tab = getFilter();
    const q = ($('#hist-search')?.value || '').trim().toLowerCase();
    let items = [...events];
    if (tab === 'created') items = items.filter((e) => e.type === 'created');
    else if (tab === 'resolved') items = items.filter((e) => e.type === 'resolved');
    else if (tab === 'overdue') items = items.filter((e) => e.type === 'overdue');
    if (q) {
      items = items.filter((e) => {
        const hay = [eventTitle(e), eventMeta(e), e.number, e.obj, e.text, e.by].join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    return items;
  }

  function renderFeed() {
    const feed = $('#hist-feed');
    const err = $('#hist-error');
    if (!feed) return;

    const events = filterEvents(flattenEvents(state.violations, state.refs));
    if (!events.length) {
      feed.innerHTML = '<p class="hist-empty">Нет событий по выбранным фильтрам</p>';
      return;
    }

    const groups = new Map();
    events.forEach((e) => {
      const key = formatDateLabel(e.at);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    });

    feed.innerHTML = [...groups.entries()]
      .map(
        ([date, list]) => `
      <section class="hist-day">
        <h3 class="hist-day-label">${esc(date)}</h3>
        <div class="hist-day-card">
          ${list
            .map(
              (e) => `<article class="hist-event" data-viol-id="${esc(e.violationId)}">
            <div class="hist-event-icon ${esc(e.type)}">${ICONS[e.type] || ICONS.system}</div>
            <div class="hist-event-body">
              <div class="hist-event-title">${esc(eventTitle(e))}</div>
              <div class="hist-event-meta">${esc(eventMeta(e))}</div>
            </div>
            <time class="hist-event-time">${esc(formatTime(e.at))}</time>
          </article>`
            )
            .join('')}
        </div>
      </section>`
      )
      .join('');

    feed.querySelectorAll('.hist-event[data-viol-id]').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.dataset.violId;
        if (!id || typeof show !== 'function') return;
        show('violations');
        if (typeof showViolationDetail === 'function') showViolationDetail(id);
      });
    });

    if (err) err.classList.add('hidden');
  }

  async function load(refs) {
    if (state.loading) return;
    state.loading = true;
    state.refs = refs || state.refs;
    const err = $('#hist-error');
    if (err) {
      err.classList.add('hidden');
      err.textContent = '';
    }
    try {
      const data = await AdminAPI.req('/violations?filter=history');
      state.violations = data.violations || [];
      renderFeed();
    } catch (e) {
      if (err) {
        err.classList.remove('hidden');
        err.textContent = e?.message || 'Ошибка загрузки истории';
      }
      if (window.adminToast) window.adminToast(e?.message || 'Ошибка загрузки истории', true);
    } finally {
      state.loading = false;
    }
  }

  function ensureReady(refs) {
    if (state.inited) return;
    $$('.hist-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        $$('.hist-tab').forEach((t) => t.classList.toggle('active', t === tab));
        renderFeed();
      });
    });
    $('#hist-search')?.addEventListener('input', () => {
      clearTimeout(ensureReady._searchT);
      ensureReady._searchT = setTimeout(() => renderFeed(), 300);
    });
    state.inited = true;
    state.refs = refs || state.refs;
  }

  function init(refs) {
    ensureReady(refs);
    load(refs);
  }

  async function onShow(refs) {
    ensureReady(refs);
    await load(refs);
  }

  return { init, onShow, load, ensureReady };
})();

window.VCHistory = VCHistory;
