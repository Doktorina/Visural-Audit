const VCAnalytics = (() => {
  const state = { inited: false, loading: false, refs: { objects: [], contractors: [] }, lastTrendData: null };

  const $ = (s) => document.querySelector(s);
  const esc = (v) => {
    const d = document.createElement('div');
    d.textContent = String(v ?? '');
    return d.innerHTML;
  };

  function setText(sel, value) {
    const el = $(sel);
    if (el) el.textContent = value;
  }

  function statusLabel(status) {
    return (
      {
        new: 'Открыто',
        in_progress: 'В работе',
        verification: 'На проверке',
        resolved: 'Устранено',
        overdue: 'Просрочено',
      }[status] || status || '—'
    );
  }

  function fillSelect(sel, items, labelFn) {
    if (!sel) return;
    const val = sel.value;
    sel.innerHTML = '<option value="">Все</option>';
    items.forEach((item) => {
      const o = document.createElement('option');
      o.value = item.id;
      o.textContent = labelFn(item);
      sel.appendChild(o);
    });
    if (val) sel.value = val;
  }

  function buildQuery() {
    const q = new URLSearchParams();
    q.set('preset', $('#qa-preset')?.value || 'all');
    q.set('status', $('#qa-status')?.value || 'all');
    q.set('severity', $('#qa-severity')?.value || 'all');
    q.set('groupBy', $('#qa-group')?.value || 'category');
    q.set('sortBy', 'count');
    const users = window.VCUserPicker?.getSelected($('#qa-user-picker')) || [];
    if (users.length) q.set('users', users.join(','));
    const contractor = $('#qa-contractor')?.value;
    if (contractor) q.set('contractors', contractor);
    const object = $('#qa-object')?.value;
    if (object) q.set('objects', object);
    return q.toString();
  }

  async function fetchAnalytics() {
    return AdminAPI.req(`/analytics?${buildQuery()}`);
  }

  function renderKpi(data) {
    setText('#qa-total', String(data.total || 0));
    setText('#qa-resolved', `${data.resolved || 0} (${data.resolvedPct || 0}%)`);
    setText('#qa-overdue', String(data.overdue || 0));
    setText('#qa-critical', String(data.critical || 0));
    setText('#qa-period', data.period?.label || 'Всё время');
  }

  function formatTrendDate(iso) {
    if (!iso) return '—';
    const d = new Date(`${iso}T12:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }

  function buildTrendPath(values, width, height, padX = 16, padTop = 12, padBottom = 12) {
    const n = values.length;
    if (!n) return { line: '', area: '', points: [] };
    const max = Math.max(...values, 1);
    const innerW = Math.max(1, width - padX * 2);
    const innerH = Math.max(1, height - padTop - padBottom);
    const stepX = n > 1 ? innerW / (n - 1) : 0;
    const points = values.map((v, i) => {
      const x = padX + stepX * i;
      const y = padTop + innerH - (v / max) * innerH;
      return { x, y, v };
    });
    if (points.length === 1) {
      const p = points[0];
      const line = `M${p.x.toFixed(2)} ${p.y.toFixed(2)} L${(p.x + 0.1).toFixed(2)} ${p.y.toFixed(2)}`;
      const area = `${line} L${(p.x + 0.1).toFixed(2)} ${(padTop + innerH).toFixed(2)} L${p.x.toFixed(2)} ${(padTop + innerH).toFixed(2)} Z`;
      return { line, area, points };
    }

    let line = `M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
    for (let i = 1; i < points.length; i++) {
      const p = points[i];
      line += ` L${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
    }
    const last = points[points.length - 1];
    const area = `${line} L${last.x.toFixed(2)} ${(padTop + innerH).toFixed(2)} L${points[0].x.toFixed(2)} ${(padTop + innerH).toFixed(2)} Z`;
    return { line, area, points };
  }

  function measureChartWidth(el) {
    const panel = el.closest('.panel');
    const rect = panel?.getBoundingClientRect();
    const w = rect?.width || el.getBoundingClientRect().width || el.clientWidth || 320;
    return Math.max(Math.floor(w), 280);
  }

  function renderTrend(data) {
    const el = $('#qa-trend');
    if (!el) return;
    const trend = data?.trend || [];
    if (!trend.length) {
      state.lastTrendData = null;
      el.innerHTML = '<p class="chart-empty">Нет данных за период</p>';
      return;
    }
    state.lastTrendData = data;
    const labels = trend.map((x) => formatTrendDate(x.date));
    const values = trend.map((x) => x.count || 0);
    const chartW = measureChartWidth(el);
    const chartH = 200;
    const padX = 4;
    const padTop = 12;
    const padBottom = 28;
    const axisY = chartH - 4;
    const { line, points } = buildTrendPath(values, chartW, chartH, padX, padTop, padBottom);
    const max = Math.max(...values, 1);
    const innerH = Math.max(1, chartH - padTop - padBottom);
    const gridValues = [max, Math.round(max * 0.66), Math.round(max * 0.33), 0];
    const grid = gridValues
      .map((v) => {
        const y = padTop + innerH - (v / max) * innerH;
        return `<g class="qa-grid-row">
          <line x1="${padX}" y1="${y.toFixed(2)}" x2="${(chartW - padX).toFixed(2)}" y2="${y.toFixed(2)}"></line>
          <text x="2" y="${(y + 4).toFixed(2)}">${v}</text>
        </g>`;
      })
      .join('');
    const dots = points
      .map(
        (p) =>
          `<circle class="qa-line-dot" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="3"></circle>`
      )
      .join('');
    const valueLabels = points
      .map((p) => {
        const y = Math.max(padTop + 6, p.y - 12);
        return `<text class="qa-line-value" x="${p.x.toFixed(2)}" y="${y.toFixed(
          2
        )}" text-anchor="middle">${p.v}</text>`;
      })
      .join('');
    const axisLabels = labels
      .map(
        (label, i) =>
          `<text class="qa-axis-text" x="${points[i].x.toFixed(2)}" y="${axisY.toFixed(
            2
          )}" text-anchor="middle">${esc(label)}</text>`
      )
      .join('');
    el.innerHTML = `<div class="qa-line-chart-wrap" role="img" aria-label="Динамика нарушений по дням">
      <svg class="qa-line-chart" viewBox="0 0 ${chartW} ${chartH}" preserveAspectRatio="none">
        ${grid}
        <path d="${line}" class="qa-line-stroke"></path>
        ${dots}
        ${valueLabels}
        ${axisLabels}
      </svg>
    </div>`;
  }

  function bindTrendResize() {
    const el = $('#qa-trend');
    const panel = el?.closest('.panel');
    if (!panel || state.trendResizeBound) return;
    state.trendResizeBound = true;
    const redraw = () => {
      if (state.lastTrendData) renderTrend(state.lastTrendData);
    };
    if (typeof ResizeObserver !== 'undefined') {
      state.trendObs = new ResizeObserver(() => redraw());
      state.trendObs.observe(panel);
    } else {
      window.addEventListener('resize', redraw);
    }
  }

  function renderBarRows(el, groups, emptyText) {
    if (!el) return;
    if (!groups.length) {
      el.innerHTML = `<p class="chart-empty">${emptyText || 'Нет данных'}</p>`;
      return;
    }
    const max = Math.max(...groups.map((x) => x.count), 1);
    el.innerHTML = groups
      .map((x) => {
        const w = Math.round((x.count / max) * 100);
        return `<div class="bar-row"><span class="bar-label">${esc(x.name)}</span><div class="track"><div class="fill" style="width:${w}%"></div></div><span class="bar-count">${x.count}</span></div>`;
      })
      .join('');
  }

  function renderCategories(data) {
    const el = $('#qa-groups');
    const groups = (data.byCategory || []).filter((x) => x.count > 0);
    renderBarRows(el, groups, 'Нет данных за период');
  }

  function renderAntiRating(data) {
    const el = $('#qa-antirating');
    if (!el) return;
    const orgs = (data.topOrganizations || []).filter((x) => x.name && x.name !== '—').slice(0, 5);
    if (!orgs.length) {
      el.innerHTML = '<p class="chart-empty">Нет данных за период</p>';
      return;
    }
    const max = Math.max(...orgs.map((x) => x.count), 1);
    el.innerHTML = orgs
      .map((x, i) => {
        const rank = i + 1;
        const tier = rank === 1 ? 'red' : rank <= 3 ? 'orange' : 'green';
        const w = Math.round((x.count / max) * 100);
        return `<div class="antirating-row antirating-${tier}">
  <span class="antirating-rank">${rank}</span>
  <span class="antirating-name">${esc(x.name)}</span>
  <div class="antirating-track"><div class="antirating-fill" style="width:${w}%"></div></div>
  <span class="antirating-count">${x.count}</span>
</div>`;
      })
      .join('');
  }

  function renderGroups(data) {
    renderCategories(data);
  }

  function statusBadge(status) {
    const label = statusLabel(status);
    const cls = String(status || 'new').replace(/[^a-z_]/g, '');
    return `<span class="badge ${cls}">${esc(label)}</span>`;
  }

  function renderRecent(data) {
    const tb = $('#qa-recent tbody');
    if (!tb) return;
    const rows = data.recent || [];
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="6" style="color:var(--muted)">Нет данных</td></tr>';
      return;
    }
    tb.innerHTML = rows
      .map(
        (v) => `<tr>
  <td><strong>${esc(v.number)}</strong></td>
  <td>${v.createdAt ? new Date(v.createdAt).toLocaleDateString('ru-RU') : '—'}</td>
  <td>${esc(v.objectName)}</td>
  <td>${esc(v.contractorName)}</td>
  <td>${esc(v.categoryName)}</td>
  <td>${statusBadge(v.status)}</td>
</tr>`
      )
      .join('');
  }

  async function apply() {
    if (state.loading) return;
    state.loading = true;
    const errorEl = $('#qa-error');
    if (errorEl) {
      errorEl.classList.add('hidden');
      errorEl.textContent = '';
    }
    try {
      const data = await fetchAnalytics();
      renderKpi(data);
      renderTrend(data);
      renderCategories(data);
      renderAntiRating(data);
      renderRecent(data);
    } catch (e) {
      if (errorEl) {
        errorEl.classList.remove('hidden');
        errorEl.textContent = e?.message || 'Ошибка аналитики';
      }
      if (window.adminToast) window.adminToast(e?.message || 'Ошибка аналитики', true);
      console.error('[VCAnalytics] apply failed', e);
    } finally {
      state.loading = false;
    }
  }

  function ensureReady() {
    if (state.inited) return;
    bindTrendResize();
    $('#qa-apply')?.addEventListener('click', apply);
    ['#qa-preset', '#qa-status', '#qa-severity', '#qa-group', '#qa-contractor', '#qa-object'].forEach((id) =>
      $(id)?.addEventListener('change', apply)
    );
    $('#qa-advanced-toggle')?.addEventListener('click', () => {
      $('#qa-advanced')?.classList.toggle('hidden');
    });
    state.inited = true;
  }

  function mountUserPicker() {
    const el = $('#qa-user-picker');
    if (!window.VCUserPicker || !el) return;
    window.VCUserPicker.mount(el, {
      users: window.appUsers || [],
      onChange: () => {
        clearTimeout(state._userT);
        state._userT = setTimeout(apply, 300);
      },
    });
  }

  function init(refs) {
    if (refs) state.refs = refs;
    ensureReady();
    fillSelect($('#qa-contractor'), state.refs.contractors || [], (c) => c.name);
    fillSelect($('#qa-object'), state.refs.objects || [], (o) => o.name);
    mountUserPicker();
    apply();
  }

  async function onShow(refs) {
    if (refs) state.refs = refs;
    ensureReady();
    fillSelect($('#qa-contractor'), state.refs.contractors || [], (c) => c.name);
    fillSelect($('#qa-object'), state.refs.objects || [], (o) => o.name);
    if (!(window.appUsers || []).length && typeof window.loadUsers === 'function') {
      try {
        await window.loadUsers();
      } catch (e) {
        console.error('[VCAnalytics] loadUsers failed', e);
      }
    }
    mountUserPicker();
    bindTrendResize();
    await apply();
    requestAnimationFrame(() => {
      if (state.lastTrendData) renderTrend(state.lastTrendData);
    });
  }

  return { init, onShow, apply, ensureReady };
})();

window.VCAnalytics = VCAnalytics;
