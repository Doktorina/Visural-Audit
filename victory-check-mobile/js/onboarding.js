/** Интерактивное обучение: шаги только через реальные действия */
const VCOnboarding = (() => {
  const PENDING_KEY = 'vc_pending_intro_dismissed';
  const LOCAL_DONE_KEY = 'vc_tutorial_done';
  const CELEBRATION_KEY = 'vc_celebration_shown';
  const TRAINING_MARKER = '[TRAINING_CONTRACTOR]';

  let steps = [];
  let stepIndex = 0;
  let active = false;
  let trainingTicket = null;
  let practiceViolationId = null;
  let waitCleanup = null;
  let boostedTarget = null;
  let hitAreaBound = false;
  let hitActivating = false;

  const $ = (s, r = document) => r.querySelector(s);

  function user() {
    return window.store?.user || null;
  }

  function perms() {
    return window.userPerms?.() || {};
  }

  function roleKey() {
    if (window.needsApproval?.()) return 'pending';
    const r = String(user()?.role || 'viewer').toLowerCase();
    if (r === 'admin') return 'admin';
    if (r === 'auditor') return 'auditor';
    if (r === 'contractor') return 'contractor';
    return 'viewer';
  }

  function roleLabel() {
    return user()?.roleLabel || 'Пользователь';
  }

  const TRAINING_PRACTICE_MARKER = '[TRAINING_PRACTICE]';

  function isTrainingViolation(v) {
    const d = String(v?.description || '');
    return d.includes(TRAINING_MARKER) || d.includes(TRAINING_PRACTICE_MARKER);
  }

  function isMyTrainingViolation(v) {
    if (!v || !user()?.id) return false;
    if (!isTrainingViolation(v)) return false;
    const uid = String(user().id);
    if (String(v.responsibleUserId || '') === uid) return true;
    if (String(v.createdByUserId || '') === uid) return true;
    return false;
  }

  async function cleanupTrainingTickets() {
    if (window.VictoryAPI?.getToken?.()) {
      try {
        await VictoryAPI.cleanupTrainingTickets();
      } catch (e) {
        console.warn('[VCOnboarding] cleanup:', e.message || e);
      }
    }
    if (window.store) {
      window.store.violations = (window.store.violations || []).filter((v) => !isMyTrainingViolation(v));
      if (Array.isArray(window.store.notifications)) {
        window.store.notifications = window.store.notifications.filter((n) => {
          const v = (window.store.violations || []).find((x) => x.id === n.violationId);
          return !n.violationId || v;
        });
      }
      window.persist?.();
    }
    trainingTicket = null;
    practiceViolationId = null;
    try {
      await window.syncViolations?.({ full: true });
    } catch (_) {}
    await window.renderList?.();
  }

  function spawnSideBursts(leftEl, rightEl, count = 24) {
    if (!leftEl || !rightEl) return;
    leftEl.innerHTML = '';
    rightEl.innerHTML = '';
    const colors = ['#22c55e', '#f59e0b', '#3b82f6', '#ec4899', '#a855f7', '#ef4444', '#fbbf24', '#14b8a6'];
    const types = ['balloon', 'star', 'confetti', 'spiral'];
    for (let i = 0; i < count; i++) {
      const fromLeft = i % 2 === 0;
      const parent = fromLeft ? leftEl : rightEl;
      const type = types[i % types.length];
      const el = document.createElement('span');
      el.className = `vc-burst-shape vc-burst-shape--${type} ${fromLeft ? 'from-left' : 'from-right'}`;
      el.style.top = `${8 + Math.random() * 72}%`;
      el.style.setProperty('--burst-y', `${(Math.random() - 0.5) * 40}vh`);
      el.style.setProperty('--burst-dur', `${1.4 + Math.random() * 1.4}s`);
      el.style.animationDelay = `${Math.random() * 0.5}s`;
      if (type === 'spiral') {
        el.style.color = colors[i % colors.length];
      } else {
        el.style.background = colors[i % colors.length];
      }
      if (type === 'confetti') {
        el.style.width = `${6 + Math.random() * 6}px`;
        el.style.height = `${10 + Math.random() * 8}px`;
      }
      parent.appendChild(el);
    }
  }

  function launchConfetti() {
    let root = $('#confetti-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'confetti-root';
      root.setAttribute('aria-hidden', 'true');
      document.body.appendChild(root);
    }
    root.innerHTML = '';
    const colors = ['#22c55e', '#f59e0b', '#3b82f6', '#ec4899', '#a855f7', '#ef4444', '#fbbf24'];
    const shapes = ['', '', 'shape-star', 'shape-balloon'];
    for (let i = 0; i < 110; i++) {
      const el = document.createElement('span');
      const fromLeft = i % 2 === 0;
      const shape = shapes[i % shapes.length];
      el.className = `confetti-piece ${fromLeft ? 'from-left' : 'from-right'} ${shape}`;
      el.style.background = colors[i % colors.length];
      el.style.animationDelay = `${Math.random() * 0.7}s`;
      el.style.animationDuration = `${1.4 + Math.random() * 1.4}s`;
      if (!shape) {
        el.style.width = `${6 + Math.random() * 6}px`;
        el.style.height = `${10 + Math.random() * 8}px`;
      }
      el.style.top = `${20 + Math.random() * 50}%`;
      root.appendChild(el);
    }
    setTimeout(() => {
      root.innerHTML = '';
    }, 4500);
  }

  function showCelebration() {
    let alreadyShown = false;
    try {
      alreadyShown = localStorage.getItem(CELEBRATION_KEY) === '1';
    } catch (_) {}
    if (!alreadyShown) {
      try {
        localStorage.setItem(CELEBRATION_KEY, '1');
      } catch (_) {}
      launchConfetti();
      spawnSideBursts($('#celebration-burst-left'), $('#celebration-burst-right'), 36);
    }
    const el = $('#training-celebration');
    if (!el) return;
    el.classList.remove('hidden');
    el.setAttribute('aria-hidden', 'false');
    const close = () => {
      el.classList.add('hidden');
      el.setAttribute('aria-hidden', 'true');
      $('#training-celebration-ok')?.removeEventListener('click', close);
      $('#celebration-burst-left').innerHTML = '';
      $('#celebration-burst-right').innerHTML = '';
    };
    $('#training-celebration-ok')?.addEventListener('click', close);
  }

  async function completeTraining() {
    await markDone();
    await cleanupTrainingTickets();
    window.showScreen?.('list');
    window.toast?.('Обучение пройдено!');
    showCelebration();
  }

  function isDone() {
    if (user()?.tutorialCompleted) return true;
    try {
      return localStorage.getItem(LOCAL_DONE_KEY) === '1';
    } catch {
      return false;
    }
  }

  async function markDone() {
    try {
      localStorage.setItem(LOCAL_DONE_KEY, '1');
    } catch (_) {}
    if (user()) user().tutorialCompleted = true;
    try {
      window.persist?.();
    } catch (_) {}
    if (window.VictoryAPI?.getToken?.()) {
      try {
        const data = await VictoryAPI.updateProfile({ tutorialCompleted: true });
        if (data?.user && window.store) {
          window.store.user = data.user;
          window.persist?.();
        }
      } catch (e) {
        console.warn('[VCOnboarding] save:', e.message || e);
      }
    }
  }

  function dismissPendingIntro() {
    try {
      sessionStorage.setItem(PENDING_KEY, '1');
    } catch (_) {}
  }

  function pendingIntroSeen() {
    try {
      return sessionStorage.getItem(PENDING_KEY) === '1';
    } catch {
      return false;
    }
  }

  function clearWait() {
    if (waitCleanup) {
      waitCleanup();
      waitCleanup = null;
    }
    if (boostedTarget) {
      boostedTarget.classList.remove('onboarding-target-active');
      boostedTarget = null;
    }
    $('.onboarding-hit-area')?.classList.add('hidden');
  }

  function boostTarget(target) {
    if (!target || boostedTarget === target) return;
    if (boostedTarget) boostedTarget.classList.remove('onboarding-target-active');
    boostedTarget = target;
    boostedTarget.classList.add('onboarding-target-active');
  }

  function rectsOverlap(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function performTargetAction(el, step) {
    if (!el) return;
    if (step.selector?.includes('#fab')) {
      if (typeof window.startWizard === 'function') window.startWizard();
      else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return;
    }
    const id = el.dataset?.id;
    if (id && typeof window.openDetail === 'function') {
      window.openDetail(id);
      return;
    }
    const screen = el.dataset?.screen;
    if (screen && typeof window.showScreen === 'function') {
      window.showScreen(screen);
      return;
    }
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }

  function bindHitArea() {
    if (hitAreaBound) return;
    const hit = $('.onboarding-hit-area');
    if (!hit) return;
    hitAreaBound = true;
    const activate = (e) => {
      const el = boostedTarget;
      const step = steps[stepIndex];
      if (!el || !step || hitActivating) return;
      e.preventDefault();
      e.stopPropagation();
      hitActivating = true;

      const isFab = step.selector?.includes('#fab');
      if (step.wait === 'event' && step.selector) {
        performTargetAction(el, step);
        $('.onboarding-hit-area')?.classList.add('hidden');
        boostedTarget?.classList.remove('onboarding-target-active');
        boostedTarget = null;
        hitActivating = false;
        return;
      }

      performTargetAction(el, step);
      clearWait();
      if (isFab) {
        advanceStep();
        hitActivating = false;
        return;
      }
      if (step.selector?.includes('ticket-card')) {
        hitActivating = false;
        return;
      }
      setTimeout(() => {
        hitActivating = false;
        advanceStep();
      }, 160);
    };
    hit.addEventListener('pointerup', activate);
  }

  function positionTargetHighlight(target, step) {
    const spotlight = $('.onboarding-spotlight');
    const hit = $('.onboarding-hit-area');
    const card = $('.onboarding-card');
    if (!spotlight || !card) return;
    if (!target || step.type === 'card' || step.hideOverlay) {
      spotlight.classList.add('hidden');
      hit?.classList.add('hidden');
      card.classList.remove('onboarding-card--anchored');
      return;
    }
    spotlight.classList.remove('hidden');
    const needsTap = step.wait === 'click' || (step.wait === 'event' && step.selector);
    if (needsTap) {
      boostTarget(target);
      bindHitArea();
      hit?.classList.remove('hidden');
    } else {
      hit?.classList.add('hidden');
    }
    const pad = 8;
    const r = applyHighlightRect(target, pad, spotlight, hit);
    card.classList.add('onboarding-card--anchored');
    const gap = 12;
    const cardW = card.offsetWidth;
    const cardH = card.offsetHeight;
    const cardLeft = Math.max(12, Math.min(r.left, window.innerWidth - cardW - 12));
    let cardTop = r.bottom + gap;
    if (step.placement === 'top' || cardTop + cardH > window.innerHeight - 16) {
      cardTop = r.top - cardH - gap;
    }
    if (cardTop < 16) cardTop = 16;
    const cardRect = {
      top: cardTop,
      bottom: cardTop + cardH,
      left: cardLeft,
      right: cardLeft + cardW,
    };
    const targetRect = {
      top: r.top - pad,
      bottom: r.bottom + pad,
      left: r.left - pad,
      right: r.right + pad,
    };
    if (rectsOverlap(cardRect, targetRect)) cardTop = 16;
    card.style.left = `${cardLeft}px`;
    card.style.top = `${cardTop}px`;
  }

  async function prepareContractorTrainingTicket() {
    if (roleKey() !== 'contractor') return;
    if (!window.VictoryAPI?.ensureContractorTrainingTicket) return;
    try {
      const data = await VictoryAPI.ensureContractorTrainingTicket();
      if (data?.violation) {
        trainingTicket = data.violation;
        if (window.store) {
          const list = Array.isArray(window.store.violations) ? window.store.violations : [];
          const idx = list.findIndex((v) => v.id === trainingTicket.id);
          if (idx >= 0) list[idx] = trainingTicket;
          else list.unshift(trainingTicket);
          window.store.violations = list;
          window.persist?.();
        }
        await window.renderList?.();
      }
    } catch (e) {
      console.warn('[VCOnboarding] training ticket:', e.message || e);
      window.toast?.(e.message || 'Не удалось создать учебный тикет');
    }
  }

  function buildTourSteps() {
    const role = roleKey();

    if (role === 'pending') {
      return [
        {
          type: 'card',
          title: 'Заявка отправлена',
          text: 'Дождитесь подтверждения администратором. После активации пройдите полное обучение.',
        },
        {
          screen: 'list',
          selector: '#btn-pending-refresh-inline, #btn-pending-refresh',
          wait: 'click',
          title: 'Проверить статус',
          text: 'Нажмите кнопку, когда администратор подтвердит доступ.',
          placement: 'top',
        },
      ];
    }

    if (role === 'contractor') {
      const num = trainingTicket?.number ? `№${trainingTicket.number}` : '';
      return [
        {
          type: 'card',
          title: 'Обучение подрядчика',
          text: 'Сейчас откроется учебный тикет. Выполните действия по шагам — кнопка «Далее» не пропустит шаги за вас.',
        },
        {
          screen: 'list',
          prepareTicket: true,
          selector: '.ticket-card[data-training="1"]',
          wait: 'click',
          title: 'Шаг 1: откройте учебный тикет',
          text: num
            ? `В списке найдите тикет ${num} с пометкой «Учебный» и нажмите на него.`
            : 'Нажмите на учебный тикет в списке.',
          placement: 'top',
        },
        {
          screen: 'detail',
          selector: '#detail-actions [data-action="comment"]',
          wait: 'click',
          openSheet: true,
          optional: true,
          onlyTraining: true,
          title: 'Шаг 2: комментарий (по желанию)',
          text: 'Нажмите «Комментарий» или пропустите шаг.',
          placement: 'top',
        },
        {
          wait: 'event',
          event: 'comment-done',
          optional: true,
          onlyTraining: true,
          hideOverlay: true,
          title: 'Шаг 2: комментарий',
          text: 'Введите текст и нажмите «Отправить», или закройте окно.',
        },
        {
          screen: 'detail',
          selector: '#detail-actions [data-action="report"]',
          wait: 'click',
          openSheet: true,
          onlyTraining: true,
          title: 'Шаг 3: отчёт об устранении',
          text: 'Нажмите «Отчёт об устранении».',
          placement: 'top',
        },
        {
          wait: 'event',
          event: 'report-done',
          onlyTraining: true,
          hideOverlay: true,
          title: 'Шаг 3: отправьте отчёт',
          text: 'Заполните форму и нажмите «Отправить».',
        },
      ];
    }

    if (role === 'admin' || role === 'auditor') {
      return [
        {
          type: 'card',
          title: `Обучение: ${roleLabel()}`,
          text: 'Практика: создайте акт через «+», пройдите мастер и закройте нарушение (статус «Устранено»).',
        },
        {
          screen: 'list',
          selector: '#fab',
          wait: 'click',
          title: 'Шаг 1: создайте акт',
          text: 'Нажмите кнопку «+» внизу экрана.',
          placement: 'top',
        },
        {
          wait: 'event',
          event: 'violation-created',
          hideOverlay: true,
        },
        {
          screen: 'detail',
          selector: '#detail-actions [data-action="status"]',
          wait: 'click',
          openSheet: true,
          title: 'Шаг 2: смените статус',
          text: 'Нажмите «Изменить статус».',
          placement: 'top',
        },
        {
          wait: 'event',
          event: 'status-done',
          requireResolved: true,
          hideOverlay: true,
          title: 'Шаг 3: закройте нарушение',
          text: 'Выберите «Устранено» и сохраните.',
        },
        {
          type: 'card',
          title: 'Обучение завершено',
          text: 'Вы создали акт и закрыли его. Подробная справка — в меню ⋮ → Справка.',
        },
      ];
    }

    return [
      {
        type: 'card',
        title: `Добро пожаловать, ${user()?.firstName || 'коллега'}!`,
        text: `Роль: ${roleLabel()}. Ознакомьтесь с разделами приложения.`,
      },
      {
        screen: 'list',
        selector: '.nav-item[data-screen="profile"]',
        wait: 'click',
        title: 'Профиль',
        text: 'Нажмите «Профиль» в нижнем меню.',
        placement: 'top',
      },
      {
        type: 'card',
        title: 'Готово',
        text: 'Справка и типовые ошибки — в меню ⋮.',
      },
    ];
  }

  const MANUAL = {
    pending: {
      intro: 'Ожидание подтверждения администратором.',
      sections: [{ title: 'Сейчас', items: ['Проверяйте статус кнопкой в списке.'] }],
      errors: [{ q: 'Долго нет ответа', a: 'Свяжитесь с администратором организации.' }],
    },
    admin: {
      intro: 'Администратор: создание актов, контроль и закрытие нарушений.',
      sections: [
        {
          title: 'Практика в обучении',
          items: ['Создать акт через «+».', 'Пройти мастер.', 'Закрыть нарушение статусом «Устранено».'],
        },
      ],
      errors: [{ q: 'Нет объектов', a: 'Добавьте объекты в админ-панели /admin.' }],
    },
    auditor: {
      intro: 'Аудитор фиксирует нарушения и контролирует устранение.',
      sections: [
        {
          title: 'Практика',
          items: ['Создать акт.', 'Дождаться отчёта подрядчика.', 'Проверить и закрыть.'],
        },
      ],
      errors: [{ q: 'Не отправляется акт', a: 'Нужны фото и описание.' }],
    },
    contractor: {
      intro: 'Подрядчик устраняет нарушения и отправляет отчёт.',
      sections: [
        {
          title: 'Учебный тикет',
          items: [
            'Виден только вам (пометка «Учебный»).',
            'Комментарий — по желанию.',
            'Отчёт с фото — обязателен в практике.',
          ],
        },
      ],
      errors: [{ q: 'Нет учебного тикета', a: 'Меню ⋮ → Пройти обучение. Нужна привязка к организации.' }],
    },
    viewer: {
      intro: 'Наблюдатель: просмотр нарушений и аналитики.',
      sections: [{ title: 'Возможности', items: ['Список, поиск, фильтры.'] }],
      errors: [],
    },
  };

  function manualForRole() {
    return MANUAL[roleKey()] || MANUAL.viewer;
  }

  function renderHelpScreen() {
    const body = $('#help-body');
    if (!body) return;
    const m = manualForRole();
    body.innerHTML = `
      <div class="help-role-badge">${esc(roleLabel())}</div>
      <p class="help-intro">${esc(m.intro)}</p>
      ${(m.sections || [])
        .map(
          (s) => `<div class="help-section"><h3>${esc(s.title)}</h3><ul>${s.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`
        )
        .join('')}
      <button type="button" class="btn-secondary help-restart-btn" id="help-restart-tour">Пройти обучение снова</button>`;
    $('#help-restart-tour')?.addEventListener('click', () => {
      window.showScreen?.('list');
      setTimeout(() => startTour({ force: true }), 350);
    });
  }

  function esc(v) {
    const d = document.createElement('div');
    d.textContent = String(v ?? '');
    return d.innerHTML;
  }

  function applyOverlayForStep(step) {
    const show = !!(active && step && !step.hideOverlay);
    const el = $('#onboarding-overlay');
    el?.classList.toggle('hidden', !show);
    el?.setAttribute('aria-hidden', show ? 'false' : 'true');
    document.documentElement.classList.toggle('onboarding-active', show);
  }

  function showOverlay(show) {
    active = show;
    if (!show) {
      applyOverlayForStep(null);
      clearWait();
      $('#onboarding-burst-left').innerHTML = '';
      $('#onboarding-burst-right').innerHTML = '';
      return;
    }
    applyOverlayForStep(steps[stepIndex] || null);
  }

  function isTargetVisible(el) {
    if (!el || el.closest('.hidden')) return false;
    const screen = el.closest('.screen');
    if (screen && !screen.classList.contains('active')) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width >= 4 && r.height >= 4;
  }

  function findTarget(selector) {
    if (!selector) return null;
    for (const sel of String(selector).split(',').map((s) => s.trim())) {
      const el = $(sel);
      if (!isTargetVisible(el)) continue;
      if (el.matches?.('button') && (el.disabled || el.classList.contains('is-busy'))) continue;
      return el;
    }
    return null;
  }

  function applyHighlightRect(target, pad, spotlight, hit) {
    const r = target.getBoundingClientRect();
    const top = r.top - pad;
    const left = r.left - pad;
    const width = r.width + pad * 2;
    const height = r.height + pad * 2;
    const topPx = `${top}px`;
    const leftPx = `${left}px`;
    const widthPx = `${width}px`;
    const heightPx = `${height}px`;
    spotlight.style.top = topPx;
    spotlight.style.left = leftPx;
    spotlight.style.width = widthPx;
    spotlight.style.height = heightPx;
    if (hit) {
      hit.style.top = topPx;
      hit.style.left = leftPx;
      hit.style.width = widthPx;
      hit.style.height = heightPx;
    }
    return r;
  }

  function positionSpotlight(target, step) {
    positionTargetHighlight(target, step);
  }

  function bindReposition(step) {
    const fn = () => {
      const t = step.selector ? findTarget(step.selector) : null;
      if (!t || step.type === 'card' || step.hideOverlay) return;
      positionTargetHighlight(t, step);
    };
    window.addEventListener('resize', fn);
    window.addEventListener('scroll', fn, true);
    const list = $('#violations-list');
    let mo = null;
    if (list) {
      mo = new MutationObserver(() => requestAnimationFrame(fn));
      mo.observe(list, { childList: true, subtree: true });
    }
    const timers = [0, 80, 200, 500].map((ms) => setTimeout(fn, ms));
    return () => {
      window.removeEventListener('resize', fn);
      window.removeEventListener('scroll', fn, true);
      mo?.disconnect();
      timers.forEach(clearTimeout);
    };
  }

  function updateStepUi(step) {
    const nextBtn = $('#onboarding-next');
    const skipStepBtn = $('#onboarding-skip-step');
    const progress = $('.onboarding-progress');
    const title = $('.onboarding-title');
    const text = $('.onboarding-text');
    const card = $('.onboarding-card');

    if (title) title.textContent = step.title || '';
    if (text) text.textContent = step.text || '';
    if (progress) {
      const actionSteps = steps.filter((s) => !s.hideOverlay && s.type !== 'card');
      const actionIndex = actionSteps.indexOf(step);
      progress.textContent =
        step.hideOverlay || step.type === 'card'
          ? ''
          : `Шаг ${actionIndex + 1} из ${actionSteps.length}`;
    }

    if (card) {
      card.classList.remove('onboarding-card--from-left', 'onboarding-card--from-right', 'onboarding-card--pop');
      void card.offsetWidth;
      const fromLeft = stepIndex % 2 === 0;
      card.classList.add(fromLeft ? 'onboarding-card--from-left' : 'onboarding-card--from-right');
      if (step.type === 'card') {
        card.classList.add('onboarding-card--pop');
      }
    }

    if (step.type === 'card') {
      nextBtn?.classList.remove('hidden');
      nextBtn.textContent = stepIndex >= steps.length - 1 ? 'Готово' : 'Понятно';
      skipStepBtn?.classList.add('hidden');
      return;
    }
    nextBtn?.classList.add('hidden');
    skipStepBtn?.classList.toggle('hidden', !step.optional);
  }

  function setupWait(step) {
    clearWait();
    if (step.type === 'card') return;
    if (step.wait === 'event' && !step.selector) return;

    if ((step.wait === 'click' || step.wait === 'event') && step.selector) {
      waitCleanup = bindReposition(step);
    }
  }

  function matchesTrainingContext(payload) {
    const v = payload?.violation;
    if (!v) return true;
    if (!isTrainingViolation(v)) return true;
    const uid = String(user()?.id || '');
    if (String(v.responsibleUserId || '') === uid) return true;
    if (String(v.createdByUserId || '') === uid) return true;
    return false;
  }

  function handleEvent(name, payload = {}) {
    if (!active) return;
    const step = steps[stepIndex];
    if (!step) return;

    if (name === 'violation-created') {
      practiceViolationId = payload.id || null;
    }

    if (
      name === 'wizard-opened' &&
      step.wait === 'click' &&
      step.selector?.includes('#fab')
    ) {
      advanceStep();
      return;
    }

    if (
      step.wait === 'click' &&
      step.openSheet &&
      ((name === 'comment-sheet-opened' && step.selector?.includes('[data-action="comment"]')) ||
        (name === 'report-sheet-opened' && step.selector?.includes('[data-action="report"]')) ||
        (name === 'status-sheet-opened' && step.selector?.includes('[data-action="status"]')))
    ) {
      advanceStep();
      return;
    }

    if (name === 'detail-opened' && step.wait === 'click' && step.selector?.includes('ticket-card')) {
      const v = (window.store?.violations || []).find((x) => x.id === payload.id);
      if (v && isTrainingViolation(v)) {
        advanceStep();
        return;
      }
    }

    if (step.onlyTraining && payload.violation && !isTrainingViolation(payload.violation)) return;
    if (step.onlyTraining && trainingTicket?.id && payload.id && payload.id !== trainingTicket.id) return;

    if (step.wait === 'event' && step.event === name) {
      if (step.requireResolved && payload.status !== 'resolved') return;
      if (step.onlyTraining && !matchesTrainingContext(payload)) return;
      if (
        name === 'report-done' &&
        roleKey() === 'contractor' &&
        payload.violation &&
        isTrainingViolation(payload.violation)
      ) {
        finish();
        return;
      }
      advanceStep();
    }

    if (
      name === 'comment-skipped' &&
      step.wait === 'event' &&
      step.event === 'comment-done' &&
      step.optional
    ) {
      advanceStep();
    }
  }

  async function renderStep() {
    const step = steps[stepIndex];
    if (!step) return finish();

    if (step.prepareTicket) await prepareContractorTrainingTicket();

    applyOverlayForStep(step);

    if (step.screen && window.showScreen) {
      const cur = document.querySelector('.screen.active')?.id?.replace('screen-', '');
      if (!cur || cur === step.screen || step.screen === 'detail') window.showScreen(step.screen);
    }

    requestAnimationFrame(() => {
      updateStepUi(step);
      const target = step.type === 'card' || step.hideOverlay ? null : findTarget(step.selector);
      if (target) {
        const bar = target.closest('#detail-actions');
        if (bar) {
          try {
            bar.scrollIntoView({ block: 'end', behavior: 'instant' });
          } catch {
            bar.scrollIntoView({ block: 'end' });
          }
        }
        try {
          target.scrollIntoView({ block: 'center', behavior: 'instant' });
        } catch {
          target.scrollIntoView({ block: 'center' });
        }
        positionSpotlight(target, step);
      } else {
        positionSpotlight(null, step);
      }
      setupWait(step);
    });
  }

  function advanceStep() {
    stepIndex += 1;
    if (stepIndex >= steps.length) finish();
    else renderStep();
  }

  function nextStep() {
    const step = steps[stepIndex];
    if (step?.type === 'card') advanceStep();
  }

  async function finish() {
    clearWait();
    showOverlay(false);
    if (roleKey() === 'pending') dismissPendingIntro();
    else await completeTraining();
  }

  async function skip() {
    clearWait();
    showOverlay(false);
    if (roleKey() === 'pending') dismissPendingIntro();
    else await completeTraining();
  }

  function skipOptionalStep() {
    const step = steps[stepIndex];
    if (!step?.optional) return;
    advanceStep();
    const next = steps[stepIndex];
    if (next?.hideOverlay && next?.optional) advanceStep();
  }

  async function startTour(opts = {}) {
    if (active) return;
    if (!opts.force && isDone() && roleKey() !== 'pending') return;

    trainingTicket = null;
    practiceViolationId = null;

    if (roleKey() === 'contractor') await prepareContractorTrainingTicket();

    steps = buildTourSteps();
    if (!steps.length) return;

    stepIndex = 0;
    showOverlay(true);
    await renderStep();
  }

  async function maybeStartAfterLogin() {
    if (!user()) return;
    if (roleKey() === 'pending') {
      if (!pendingIntroSeen()) await startTour();
      return;
    }
    if (!isDone()) await startTour();
  }

  function openHelp() {
    window.showScreen?.('help');
    renderHelpScreen();
  }

  function bindUi() {
    $('#onboarding-next')?.addEventListener('click', nextStep);
    $('#onboarding-skip')?.addEventListener('click', skip);
    $('#onboarding-skip-step')?.addEventListener('click', skipOptionalStep);
    $('#menu-training')?.addEventListener('click', () => {
      closeAppMenu?.();
      startTour({ force: true });
    });
    $('#goto-help')?.addEventListener('click', openHelp);
    $('#help-back')?.addEventListener('click', () => window.showScreen?.('profile'));
  }

  function isActive() {
    return active;
  }

  return {
    startTour,
    maybeStartAfterLogin,
    openHelp,
    renderHelpScreen,
    bindUi,
    isDone,
    isActive,
    handleEvent,
    spawnSideBursts,
  };
})();

window.VCOnboarding = VCOnboarding;

function closeAppMenu() {
  $('#app-menu-dropdown')?.classList.add('hidden');
  $('#btn-app-menu')?.setAttribute('aria-expanded', 'false');
}
