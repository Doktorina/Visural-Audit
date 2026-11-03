/** Поиск и мультивыбор сотрудников */
const VCUserPicker = (() => {
  const esc = (v) => {
    const d = document.createElement('div');
    d.textContent = String(v ?? '');
    return d.innerHTML;
  };

  function userLabel(u) {
    const name = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.name || u.email;
    const org = u.company ? ` · ${u.company}` : '';
    return `${name} (${u.email})${org}`;
  }

  function userShortLabel(u) {
    return `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.name || u.email;
  }

  function userHaystack(u) {
    return [u.firstName, u.lastName, u.name, u.email, u.company, u.phone]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  }

  function matchesQuery(u, query) {
    if (!query) return true;
    const hay = userHaystack(u);
    return query.split(/\s+/).filter(Boolean).every((tok) => hay.includes(tok));
  }

  function sortByName(list) {
    return [...list].sort((a, b) => userLabel(a).localeCompare(userLabel(b), 'ru'));
  }

  function bindComboPicker(state) {
    const { container, box, search, chips, drop } = state.els;
    let open = false;

    function notifyChange() {
      state.onChange?.(state.selected);
    }

    function setOpen(v) {
      open = v;
      drop.classList.toggle('hidden', !open);
    }

    function renderChips() {
      const items = state.selected
        .map((id) => {
          const u = state.users.find((x) => x.id === id);
          if (!u) return '';
          return `<span class="user-picker-chip" title="${esc(userLabel(u))}">${esc(userShortLabel(u))}<button type="button" data-remove="${esc(id)}" aria-label="Убрать">×</button></span>`;
        })
        .filter(Boolean);

      if (items.length) {
        items.push(
          `<button type="button" class="user-picker-clear" data-clear-all>Сбросить (${state.selected.length})</button>`
        );
      }
      chips.innerHTML = items.join('');

      chips.querySelectorAll('[data-remove]').forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          state.selected = state.selected.filter((x) => x !== btn.dataset.remove);
          renderChips();
          renderDrop();
          notifyChange();
        };
      });
      chips.querySelector('[data-clear-all]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        state.selected = [];
        renderChips();
        renderDrop();
        notifyChange();
        search.focus();
      });
    }

    function pickUser(id) {
      if (!state.selected.includes(id)) state.selected.push(id);
      search.value = '';
      renderChips();
      renderDrop();
      notifyChange();
      search.focus();
    }

    function renderDrop() {
      const query = String(search.value || '').trim().toLowerCase();
      const unselected = state.users.filter((u) => !state.selected.includes(u.id));
      let items = unselected.filter((u) => matchesQuery(u, query));

      if (!state.users.length) {
        drop.innerHTML = `<p class="user-picker-empty">${esc(state.emptyHint)}</p>`;
        return;
      }

      if (!query) {
        drop.innerHTML = '<p class="user-picker-empty">Введите имя, email или компанию</p>';
        return;
      }

      if (!items.length) {
        drop.innerHTML = '<p class="user-picker-empty">Никого не найдено</p>';
        return;
      }

      items = sortByName(items).slice(0, 12);
      drop.innerHTML = items
        .map(
          (u) => `<button type="button" class="user-picker-option" data-pick="${esc(u.id)}">
            <span class="user-picker-option-name">${esc(userShortLabel(u))}</span>
            <span class="user-picker-option-meta">${esc(u.email)}${u.company ? ` · ${esc(u.company)}` : ''}</span>
          </button>`
        )
        .join('');

      drop.querySelectorAll('[data-pick]').forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          pickUser(btn.dataset.pick);
        };
      });
    }

    state.render = () => {
      renderChips();
      if (open) renderDrop();
    };

    search.addEventListener('input', () => {
      setOpen(true);
      renderDrop();
    });
    search.addEventListener('focus', () => {
      setOpen(true);
      renderDrop();
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        search.blur();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = drop.querySelector('[data-pick]');
        if (first) pickUser(first.dataset.pick);
      }
      if (e.key === 'Backspace' && !search.value && state.selected.length) {
        state.selected.pop();
        renderChips();
        notifyChange();
      }
    });
    box.addEventListener('click', () => search.focus());
    document.addEventListener('click', (e) => {
      if (!container.contains(e.target)) setOpen(false);
    });

    renderChips();
  }

  function bindInlinePicker(state) {
    const { search, list, summary } = state.els;

    function notifyChange() {
      state.onChange?.(state.selected);
    }

    function toggleUser(id) {
      if (state.selected.includes(id)) {
        state.selected = state.selected.filter((x) => x !== id);
      } else {
        state.selected.push(id);
      }
      renderList();
      renderSummary();
      notifyChange();
    }

    function renderSummary() {
      if (!summary) return;
      const n = state.selected.length;
      summary.textContent = n
        ? `Выбрано: ${n}`
        : state.users.length
          ? `Сотрудников в компании: ${state.users.length}`
          : '';
    }

    function renderList() {
      const query = String(search.value || '').trim().toLowerCase();
      let items = state.users.filter((u) => matchesQuery(u, query));

      if (!state.users.length) {
        list.innerHTML = `<p class="user-picker-empty">${esc(state.emptyHint)}</p>`;
        renderSummary();
        return;
      }

      if (!items.length) {
        list.innerHTML = '<p class="user-picker-empty">Никого не найдено</p>';
        renderSummary();
        return;
      }

      items = sortByName(items);
      list.innerHTML = items
        .map((u) => {
          const on = state.selected.includes(u.id);
          return `<label class="user-picker-inline-row${on ? ' selected' : ''}">
            <input type="checkbox" data-pick="${esc(u.id)}"${on ? ' checked' : ''}>
            <span class="user-picker-inline-text">
              <span class="user-picker-inline-name">${esc(userShortLabel(u))}</span>
              <span class="user-picker-inline-meta">${esc(u.email)}${u.phone ? ` · ${esc(u.phone)}` : ''}</span>
            </span>
          </label>`;
        })
        .join('');

      list.querySelectorAll('[data-pick]').forEach((input) => {
        input.onchange = () => toggleUser(input.dataset.pick);
      });
      renderSummary();
    }

    state.render = () => renderList();

    search.addEventListener('input', () => renderList());
    renderList();
  }

  function mount(
    container,
    {
      users = [],
      selectedIds = [],
      onChange,
      variant = 'combo',
      placeholder = 'Поиск по имени или email…',
      emptyHint = 'Список сотрудников пуст',
    } = {}
  ) {
    if (!container) return;

    const prevSelected = container._vcPicker?.selected || [];
    if (container._vcPicker && container._vcPicker.variant !== variant) {
      delete container._vcPicker;
      container.className = '';
      container.innerHTML = '';
    }

    if (container._vcPicker) {
      container._vcPicker.users = users || [];
      container._vcPicker.onChange = typeof onChange === 'function' ? onChange : container._vcPicker.onChange;
      container._vcPicker.selected = selectedIds.length ? [...selectedIds] : prevSelected;
      container._vcPicker.emptyHint = emptyHint;
      container._vcPicker.render?.();
      return;
    }

    const state = {
      users: users || [],
      selected: selectedIds.length ? [...selectedIds] : [],
      onChange: typeof onChange === 'function' ? onChange : null,
      emptyHint,
      variant,
      els: {},
    };
    container._vcPicker = state;
    container.classList.add('user-picker', `user-picker--${variant}`);

    if (variant === 'inline') {
      container.innerHTML = `
        <div class="user-picker-field">
          <input type="search" class="user-picker-search" placeholder="${esc(placeholder)}" autocomplete="off">
        </div>
        <p class="user-picker-summary"></p>
        <div class="user-picker-inline-list" role="listbox"></div>`;
      state.els = {
        container,
        search: container.querySelector('.user-picker-search'),
        summary: container.querySelector('.user-picker-summary'),
        list: container.querySelector('.user-picker-inline-list'),
      };
      bindInlinePicker(state);
      return;
    }

    container.innerHTML = `
      <div class="user-picker-box">
        <div class="user-picker-chips"></div>
        <input type="search" class="user-picker-search" placeholder="${esc(placeholder)}" autocomplete="off">
      </div>
      <div class="user-picker-drop hidden" role="listbox" aria-label="Результаты поиска"></div>`;

    state.els = {
      container,
      box: container.querySelector('.user-picker-box'),
      search: container.querySelector('.user-picker-search'),
      chips: container.querySelector('.user-picker-chips'),
      drop: container.querySelector('.user-picker-drop'),
    };
    bindComboPicker(state);
  }

  function getSelected(container) {
    return container?._vcPicker?.selected || [];
  }

  function setUsers(container, users) {
    if (!container?._vcPicker) return;
    container._vcPicker.users = users || [];
    container._vcPicker.render?.();
  }

  function clear(container) {
    if (!container?._vcPicker) return;
    container._vcPicker.selected = [];
    container._vcPicker.render?.();
    container._vcPicker.onChange?.([]);
  }

  return { mount, getSelected, setUsers, clear, userLabel, userShortLabel };
})();

window.VCUserPicker = VCUserPicker;
