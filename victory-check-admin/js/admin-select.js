/** Кастомный select в стиле админки (нативный popup нельзя стилизовать на Windows) */
const VCAdminSelect = (() => {
  const instances = new Map();
  let docBound = false;

  const esc = (v) => {
    const d = document.createElement('div');
    d.textContent = String(v ?? '');
    return d.innerHTML;
  };

  function closeAll(except) {
    instances.forEach((st) => {
      if (st !== except && st.open) st.setOpen(false);
    });
  }

  function bindDoc() {
    if (docBound) return;
    docBound = true;
    document.addEventListener('click', () => closeAll(null));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAll(null);
    });
  }

  function enhance(select) {
    if (!select || select.dataset.vcEnhanced === '1') return instances.get(select);

    bindDoc();

    const wrap = document.createElement('div');
    wrap.className = 'vc-select';
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);

    select.classList.add('vc-select-native');
    select.dataset.vcEnhanced = '1';
    select.tabIndex = -1;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'vc-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const drop = document.createElement('div');
    drop.className = 'vc-select-drop hidden';
    drop.setAttribute('role', 'listbox');

    wrap.appendChild(trigger);
    wrap.appendChild(drop);

    const state = { select, wrap, trigger, drop, open: false };

    state.setOpen = (v) => {
      state.open = v;
      drop.classList.toggle('hidden', !v);
      trigger.setAttribute('aria-expanded', v ? 'true' : 'false');
      if (v) closeAll(state);
    };

    state.syncTrigger = () => {
      const opt = select.options[select.selectedIndex];
      trigger.textContent = opt ? opt.textContent : '—';
    };

    state.renderDrop = () => {
      const val = select.value;
      drop.innerHTML = [...select.options]
        .map((o) => {
          const selected = o.value === val ? ' selected' : '';
          const disabled = o.disabled ? ' disabled' : '';
          return `<button type="button" class="vc-select-option${selected}${disabled}" data-value="${esc(o.value)}" role="option" aria-selected="${o.value === val ? 'true' : 'false'}"${o.disabled ? ' disabled' : ''}>${esc(o.textContent)}</button>`;
        })
        .join('');

      drop.querySelectorAll('.vc-select-option:not([disabled])').forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const next = btn.dataset.value;
          if (select.value !== next) {
            select.value = next;
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }
          state.syncTrigger();
          state.renderDrop();
          state.setOpen(false);
        };
      });
    };

    state.refresh = () => {
      state.syncTrigger();
      state.renderDrop();
    };

    trigger.onclick = (e) => {
      e.stopPropagation();
      state.setOpen(!state.open);
    };

    drop.onclick = (e) => e.stopPropagation();

    const obs = new MutationObserver(() => state.refresh());
    obs.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['selected', 'disabled'] });

    state.refresh();
    instances.set(select, state);
    return state;
  }

  function enhanceAll(root = document) {
    const q =
      'select.admin-select, #page-analytics select, .history-actions select, .member-card-edit select, #assign-user-select, .status-select, .user-role-select';
    root.querySelectorAll(q).forEach(enhance);
  }

  function refresh(select) {
    instances.get(select)?.refresh();
  }

  return { enhance, enhanceAll, refresh };
})();

window.VCAdminSelect = VCAdminSelect;
