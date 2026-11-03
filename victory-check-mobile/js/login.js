/**
 * Вход, регистрация и восстановление пароля через VictoryAPI
 */
(function () {
  var registerAwaitingCode = false;
  var registerInFlight = false;
  var forgotAwaitingCode = false;
  var orgSuggestTimers = {};

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function normalizeCompanyText(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[«»"""']/g, '')
      .replace(/^(ооо|ао|ип|зао|пао|оао)\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function fetchOrganizations(q) {
    var V = api();
    if (!V || !V.searchOrganizations) return Promise.resolve([]);
    return V.searchOrganizations(q)
      .then(function (d) {
        return d.organizations || [];
      })
      .catch(function () {
        return [];
      });
  }

  function resolveCompanyName(raw) {
    var q = String(raw || '').trim();
    if (!q) return Promise.resolve(q);
    return fetchOrganizations(q).then(function (items) {
      if (!items.length) return q;
      var top = items[0];
      var nRaw = normalizeCompanyText(q);
      var nTop = normalizeCompanyText(top.name);
      if (nRaw === nTop || nTop.indexOf(nRaw) >= 0 || nRaw.indexOf(nTop) >= 0) return top.name;
      return q;
    });
  }

  function mountCompanyPicker(inputId, suggestId, hintId) {
    var input = document.getElementById(inputId);
    var suggest = document.getElementById(suggestId);
    var hint = document.getElementById(hintId);
    if (!input || !suggest || input.dataset.vcCompanyPicker) return;
    input.dataset.vcCompanyPicker = '1';

    function hideSuggest() {
      suggest.classList.add('hidden');
      suggest.innerHTML = '';
    }

    function pickOrg(name) {
      input.value = name;
      input.dataset.picked = '1';
      hideSuggest();
      if (hint) {
        hint.classList.add('hidden');
        hint.textContent = '';
      }
    }

    function showSuggest(items) {
      if (!items.length) {
        hideSuggest();
        return;
      }
      suggest.innerHTML = items
        .map(function (o) {
          return (
            '<button type="button" class="company-suggest-item" data-name="' +
            escapeHtml(o.name).replace(/"/g, '&quot;') +
            '">' +
            escapeHtml(o.name) +
            '</button>'
          );
        })
        .join('');
      suggest.classList.remove('hidden');
      suggest.querySelectorAll('.company-suggest-item').forEach(function (btn) {
        btn.onclick = function () {
          pickOrg(btn.getAttribute('data-name') || '');
        };
      });
    }

    function updateHint(q, items) {
      if (!hint || input.dataset.picked === '1') return;
      if (!q || q.length < 2 || !items.length) {
        hint.classList.add('hidden');
        hint.textContent = '';
        return;
      }
      var top = items[0];
      if (normalizeCompanyText(top.name) === normalizeCompanyText(q)) {
        hint.classList.add('hidden');
        return;
      }
      hint.innerHTML =
        'Возможно, вы имели в виду: <button type="button" class="company-suggest-link">' +
        escapeHtml(top.name) +
        '</button>';
      hint.classList.remove('hidden');
      var link = hint.querySelector('.company-suggest-link');
      if (link) {
        link.onclick = function () {
          pickOrg(top.name);
        };
      }
    }

    function refreshSuggestions() {
      var q = input.value.trim();
      fetchOrganizations(q).then(function (items) {
        if (input.dataset.picked === '1') return;
        showSuggest(items);
        updateHint(q, items);
      });
    }

    input.addEventListener('input', function () {
      input.dataset.picked = '';
      clearTimeout(orgSuggestTimers[inputId]);
      orgSuggestTimers[inputId] = setTimeout(refreshSuggestions, 180);
    });

    input.addEventListener('focus', function () {
      refreshSuggestions();
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') hideSuggest();
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('.company-picker-wrap')) hideSuggest();
    });
  }

  window.vcResolveCompanyName = resolveCompanyName;
  window.vcMountCompanyPicker = mountCompanyPicker;

  function showErr(msg) {
    var el = document.getElementById('login-error');
    if (el) el.textContent = msg || '';
    var t = document.getElementById('toast');
    if (t && msg) {
      t.textContent = msg;
      t.classList.add('show');
      setTimeout(function () {
        t.classList.remove('show');
      }, 4000);
    }
  }

  function showAuthScreen(id) {
    document.querySelectorAll('.screen').forEach(function (s) {
      s.classList.remove('active');
    });
    var el = document.getElementById('screen-' + id);
    if (el) el.classList.add('active');
  }

  function setButtonsLoading(on) {
    var btn = document.getElementById('login-submit');
    if (!btn) return;
    btn.disabled = !!on;
    btn.textContent = on ? 'Вход…' : 'Войти';
  }

  function api() {
    return window.VictoryAPI;
  }

  function resolveServer() {
    var V = api();
    if (!V) return 'https://audit.visural.ru';
    if (V.isServerDeploy && V.isServerDeploy()) {
      var s = window.location.origin.replace(/\/$/, '');
      V.setServerUrl(s);
      return s;
    }
    var remote = 'https://audit.visural.ru';
    V.setServerUrl(remote);
    return remote;
  }

  function rememberSyncCreds(email, pass) {
    try {
      sessionStorage.setItem('vc_sync_email', email);
      sessionStorage.setItem('vc_sync_pass', pass);
    } catch (e) {}
  }

  function getCredentials() {
    var emailEl = document.getElementById('login-email');
    var passEl = document.getElementById('login-password');
    var email = emailEl ? emailEl.value.trim() : '';
    var pass = passEl ? passEl.value : '';
    if (!email || !pass) {
      showErr('Введите email и пароль');
      return null;
    }
    if (email.indexOf('@') < 0) {
      showErr('Укажите полный email');
      return null;
    }
    return { email: email, pass: pass };
  }

  function finishLogin(data) {
    setButtonsLoading(false);
    showErr('');
    if (!data || !data.token || !data.user) {
      showErr('Ошибка: сервер не вернул токен');
      return;
    }
    var V = api();
    if (V && V.setToken) V.setToken(data.token);
    if (typeof window.vcFinishLogin === 'function') {
      window.vcFinishLogin(data).catch(function (e) {
        setButtonsLoading(false);
        showErr(e.message || 'Ошибка входа');
      });
      return;
    }
    try {
      localStorage.removeItem('vc_offline_mode');
      localStorage.setItem('vc_token', data.token);
      localStorage.setItem('vc_login_user', JSON.stringify(data.user));
      sessionStorage.setItem('vc_mode', 'mobile');
    } catch (e) {}
    window.location.reload();
  }

  function setRegisterCodeMode(on, hint) {
    registerAwaitingCode = !!on;
    var block = document.getElementById('register-verify-block');
    var btn = document.getElementById('register-submit');
    var resendBtn = document.getElementById('register-resend');
    var hintEl = document.getElementById('register-hint');
    var nameEl = document.getElementById('register-name');
    var companyEl = document.getElementById('register-company');
    var jobEl = document.getElementById('register-job-title');
    var phoneEl = document.getElementById('register-phone');
    var emailEl = document.getElementById('register-email');
    if (block) block.classList.toggle('hidden', !on);
    if (resendBtn) resendBtn.classList.toggle('hidden', !on);
    if (nameEl) nameEl.readOnly = !!on;
    if (companyEl) companyEl.readOnly = !!on;
    if (jobEl) jobEl.readOnly = !!on;
    if (phoneEl) phoneEl.readOnly = !!on;
    if (emailEl) emailEl.readOnly = !!on;
    if (btn) btn.textContent = on ? 'Подтвердить регистрацию' : 'Получить код на почту';
    if (hintEl) hintEl.textContent = hint || '';
    if (!on) {
      var codeInp = document.getElementById('register-code');
      var passInp = document.getElementById('register-password');
      if (codeInp) codeInp.value = '';
      if (passInp) passInp.value = '';
    }
    if (on) {
      var codeFocus = document.getElementById('register-code');
      if (codeFocus) codeFocus.focus();
    }
  }

  function setForgotCodeMode(on, hint) {
    forgotAwaitingCode = !!on;
    var block = document.getElementById('forgot-verify-block');
    var btn = document.getElementById('forgot-submit');
    var hintEl = document.getElementById('forgot-hint');
    var emailEl = document.getElementById('forgot-email');
    if (block) block.classList.toggle('hidden', !on);
    if (emailEl) emailEl.readOnly = !!on;
    if (btn) btn.textContent = on ? 'Сохранить новый пароль' : 'Получить код';
    if (hintEl) hintEl.textContent = hint || '';
    if (!on) {
      var codeInp = document.getElementById('forgot-code');
      var passInp = document.getElementById('forgot-password');
      if (codeInp) codeInp.value = '';
      if (passInp) passInp.value = '';
    }
    if (on) {
      var codeFocus = document.getElementById('forgot-code');
      if (codeFocus) codeFocus.focus();
    }
  }

  function doLogin() {
    var creds = getCredentials();
    if (!creds) return;
    var V = api();
    if (!V) {
      showErr('Ошибка загрузки. Обновите страницу (Ctrl+Shift+R)');
      return;
    }
    rememberSyncCreds(creds.email, creds.pass);
    resolveServer();
    setButtonsLoading(true);
    showErr('');
    V.login(creds.email, creds.pass)
      .then(function (data) {
        finishLogin(data);
      })
      .catch(function (e) {
        setButtonsLoading(false);
        showErr(e.message || 'Неверный email или пароль');
      });
  }

  window.vcLoginServer = doLogin;
  window.vcLogin = doLogin;

  window.vcRegister = function () {
    if (registerInFlight) return;
    var nameEl = document.getElementById('register-name');
    var companyEl = document.getElementById('register-company');
    var jobEl = document.getElementById('register-job-title');
    var phoneEl = document.getElementById('register-phone');
    var emailEl = document.getElementById('register-email');
    var passEl = document.getElementById('register-password');
    var codeEl = document.getElementById('register-code');
    var errEl = document.getElementById('register-error');
    var btn = document.getElementById('register-submit');
    var name = nameEl ? nameEl.value.trim() : '';
    var company = companyEl ? companyEl.value.trim() : '';
    var jobTitle = jobEl ? jobEl.value.trim() : '';
    var phone = phoneEl ? phoneEl.value.trim() : '';
    var email = emailEl ? emailEl.value.trim().toLowerCase() : '';
    var pass = passEl ? passEl.value : '';
    var code = codeEl ? codeEl.value.trim() : '';

    function showRErr(msg) {
      if (errEl) errEl.textContent = msg || '';
      var t = document.getElementById('toast');
      if (t && msg) {
        t.textContent = msg;
        t.classList.add('show');
        setTimeout(function () {
          t.classList.remove('show');
        }, 4000);
      }
    }

    if (!name || !email) {
      showRErr('Укажите ФИО и email');
      return;
    }
    if (!company) {
      showRErr('Укажите организацию');
      return;
    }
    if (!phone) {
      showRErr('Укажите телефон');
      return;
    }
    if (email.indexOf('@') < 0) {
      showRErr('Укажите полный email');
      return;
    }

    resolveCompanyName(company).then(function (resolved) {
      if (resolved && companyEl) {
        companyEl.value = resolved;
        company = resolved;
      }
      continueRegister();
    });

    function continueRegister() {
    if (registerAwaitingCode) {
      if (!code) {
        showRErr('Введите код из письма');
        return;
      }
      if (pass.length < 6) {
        showRErr('Пароль не менее 6 символов');
        return;
      }
    }

    var V = api();
    if (!V) {
      showRErr('Ошибка загрузки. Обновите страницу');
      return;
    }

    resolveServer();
    if (btn) {
      btn.disabled = true;
      btn.textContent = registerAwaitingCode ? 'Проверка…' : 'Отправка…';
    }
    showRErr('');

    var payload = { name: name, email: email, company: company, phone: phone, jobTitle: jobTitle };
    if (registerAwaitingCode) {
      payload.code = code;
      payload.password = pass;
    }

    registerInFlight = true;
    V.register(payload)
      .then(function (data) {
        if (btn) btn.disabled = false;
        if (data.needsVerification) {
          if (data.company && companyEl) companyEl.value = data.company;
          setRegisterCodeMode(true, data.message || 'Код отправлен на почту');
          showRErr('');
          if (btn) btn.textContent = 'Подтвердить регистрацию';
          var t = document.getElementById('toast');
          if (t) {
            var toastMsg = data.message || 'Код отправлен';
            if (data.companyMatched && data.company) {
              toastMsg = 'Организация: «' + data.company + '»';
            }
            t.textContent = toastMsg;
            t.classList.add('show');
            setTimeout(function () {
              t.classList.remove('show');
            }, 5000);
          }
          return;
        }
        if (data.token && data.user) {
          setRegisterCodeMode(false, '');
          rememberSyncCreds(email, pass);
          finishLogin(data);
          return;
        }
        if (btn) btn.textContent = registerAwaitingCode ? 'Подтвердить регистрацию' : 'Получить код на почту';
        showRErr('Неожиданный ответ сервера');
      })
      .catch(function (e) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = registerAwaitingCode ? 'Подтвердить регистрацию' : 'Получить код на почту';
        }
        var msg = e.message || 'Ошибка регистрации';
        if (/aborted|abort/i.test(msg)) {
          msg = 'Сервер не ответил вовремя. Проверьте интернет и попробуйте ещё раз.';
        }
        showRErr(msg);
      })
      .finally(function () {
        registerInFlight = false;
      });
    }
  };

  window.vcRegisterResend = function () {
    var nameEl = document.getElementById('register-name');
    var companyEl = document.getElementById('register-company');
    var jobEl = document.getElementById('register-job-title');
    var phoneEl = document.getElementById('register-phone');
    var emailEl = document.getElementById('register-email');
    var errEl = document.getElementById('register-error');
    var resendBtn = document.getElementById('register-resend');
    var name = nameEl ? nameEl.value.trim() : '';
    var company = companyEl ? companyEl.value.trim() : '';
    var jobTitle = jobEl ? jobEl.value.trim() : '';
    var phone = phoneEl ? phoneEl.value.trim() : '';
    var email = emailEl ? emailEl.value.trim().toLowerCase() : '';

    function showRErr(msg) {
      if (errEl) errEl.textContent = msg || '';
      var t = document.getElementById('toast');
      if (t && msg) {
        t.textContent = msg;
        t.classList.add('show');
        setTimeout(function () {
          t.classList.remove('show');
        }, 4000);
      }
    }

    if (!name || !email) return showRErr('Укажите ФИО и email');
    if (!company) return showRErr('Укажите организацию');
    if (!phone) return showRErr('Укажите телефон');
    if (email.indexOf('@') < 0) return showRErr('Укажите полный email');

    var V = api();
    if (!V) return showRErr('Ошибка загрузки. Обновите страницу');

    resolveServer();
    if (resendBtn) {
      resendBtn.disabled = true;
      resendBtn.textContent = 'Отправка…';
    }
    showRErr('');

    resolveCompanyName(company).then(function (resolved) {
      if (resolved && companyEl) {
        companyEl.value = resolved;
        company = resolved;
      }
      V.register({ name: name, email: email, company: company, phone: phone, jobTitle: jobTitle })
        .then(function (data) {
          if (resendBtn) {
            resendBtn.disabled = false;
            resendBtn.textContent = 'Получить код снова';
          }
          if (data.company && companyEl) companyEl.value = data.company;
          if (data.needsVerification) {
            setRegisterCodeMode(true, data.message || 'Код отправлен на почту');
            return;
          }
          showRErr('Неожиданный ответ сервера');
        })
        .catch(function (e) {
          if (resendBtn) {
            resendBtn.disabled = false;
            resendBtn.textContent = 'Получить код снова';
          }
          showRErr(e.message || 'Не удалось отправить код');
        });
    });
  };

  document.getElementById('register-resend')?.addEventListener('click', function () {
    if (typeof window.vcRegisterResend === 'function') window.vcRegisterResend();
  });

  function doForgotPassword(e) {
    if (e) e.preventDefault();
    var emailEl = document.getElementById('forgot-email');
    var codeEl = document.getElementById('forgot-code');
    var passEl = document.getElementById('forgot-password');
    var errEl = document.getElementById('forgot-error');
    var btn = document.getElementById('forgot-submit');
    var email = emailEl ? emailEl.value.trim().toLowerCase() : '';
    var code = codeEl ? codeEl.value.trim() : '';
    var pass = passEl ? passEl.value : '';

    function showFErr(msg) {
      if (errEl) errEl.textContent = msg || '';
      var t = document.getElementById('toast');
      if (t && msg) {
        t.textContent = msg;
        t.classList.add('show');
        setTimeout(function () {
          t.classList.remove('show');
        }, 4000);
      }
    }

    if (!email || email.indexOf('@') < 0) {
      showFErr('Укажите корректный email');
      return;
    }
    if (forgotAwaitingCode) {
      if (!code) {
        showFErr('Введите код из письма');
        return;
      }
      if (pass.length < 6) {
        showFErr('Пароль не менее 6 символов');
        return;
      }
    }

    var V = api();
    if (!V || !V.forgotPassword) {
      showFErr('Ошибка загрузки. Обновите страницу');
      return;
    }

    resolveServer();
    if (btn) {
      btn.disabled = true;
      btn.textContent = forgotAwaitingCode ? 'Сохранение…' : 'Отправка…';
    }
    showFErr('');

    var payload = { email: email };
    if (forgotAwaitingCode) {
      payload.code = code;
      payload.password = pass;
    }

    V.forgotPassword(payload)
      .then(function (data) {
        if (btn) btn.disabled = false;
        if (data.needsVerification) {
          setForgotCodeMode(true, data.message || 'Код отправлен на почту');
          showFErr('');
          if (btn) btn.textContent = 'Сохранить новый пароль';
          return;
        }
        setForgotCodeMode(false, '');
        showFErr('');
        var t = document.getElementById('toast');
        if (t) {
          t.textContent = data.message || 'Пароль обновлён';
          t.classList.add('show');
          setTimeout(function () {
            t.classList.remove('show');
          }, 4000);
        }
        if (emailEl) {
          var loginEmail = document.getElementById('login-email');
          if (loginEmail) loginEmail.value = email;
        }
        showAuthScreen('login');
      })
      .catch(function (e) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = forgotAwaitingCode ? 'Сохранить новый пароль' : 'Получить код';
        }
        showFErr(e.message || 'Не удалось восстановить пароль');
      });
  }

  window.vcResetRegisterForm = function () {
    setRegisterCodeMode(false, '');
    registerAwaitingCode = false;
    var errEl = document.getElementById('register-error');
    if (errEl) errEl.textContent = '';
  };

  window.vcResetForgotForm = function () {
    setForgotCodeMode(false, '');
    forgotAwaitingCode = false;
    var errEl = document.getElementById('forgot-error');
    if (errEl) errEl.textContent = '';
  };

  function bindLoginForm() {
    var form = document.getElementById('login-form');
    if (!form || form.dataset.vcBound) return;
    form.dataset.vcBound = '1';
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      doLogin();
    });
  }

  function bindForgotForm() {
    var form = document.getElementById('forgot-form');
    if (!form || form.dataset.vcBound) return;
    form.dataset.vcBound = '1';
    form.addEventListener('submit', doForgotPassword);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }

  function onReady() {
    try {
      localStorage.removeItem('vc_offline_mode');
    } catch (e) {}
    var V = api();
    if (V) V.setServerUrl(resolveServer());
    bindLoginForm();
    bindForgotForm();
    mountCompanyPicker('register-company', 'register-company-suggest', 'register-company-hint');
    mountCompanyPicker('profile-edit-company', 'profile-edit-company-suggest', 'profile-edit-company-hint');

    var forgotBtn = document.getElementById('btn-forgot-password');
    if (forgotBtn) {
      forgotBtn.addEventListener('click', function () {
        window.vcResetForgotForm();
        var loginEmail = document.getElementById('login-email');
        var forgotEmail = document.getElementById('forgot-email');
        if (loginEmail && forgotEmail && loginEmail.value.trim()) {
          forgotEmail.value = loginEmail.value.trim();
        }
        showAuthScreen('forgot-password');
      });
    }

    var forgotBack = document.getElementById('forgot-back');
    if (forgotBack) {
      forgotBack.addEventListener('click', function () {
        window.vcResetForgotForm();
        showAuthScreen('login');
      });
    }

    var gotoBtn = document.getElementById('btn-goto-register');
    if (gotoBtn) gotoBtn.addEventListener('click', window.vcResetRegisterForm);
    var backBtn = document.getElementById('register-back');
    if (backBtn) backBtn.addEventListener('click', window.vcResetRegisterForm);
  }
})();
