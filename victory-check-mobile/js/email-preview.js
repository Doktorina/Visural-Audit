/** Предпросмотр email и отправка через Gmail (бесплатно, без настройки) */

function buildWizardEmailPreview(wizard, violationNumber) {
  const obj = getObject(wizard.objectId);
  const org = getContractor(wizard.contractorId);
  const num = violationNumber || '—';

  const alertSubject = `[Visural Audit] Новое нарушение №${num}`;
  const alertBody = `Здравствуйте, ${org?.executor || 'коллега'}!

Зарегистрировано новое нарушение №${num} на объекте «${obj?.name || '—'}».

Акт-предписание будет отправлен отдельным письмом.

Visural Audit`;

  const actSubject = `[Visural Audit] Акт-предписание — ${num}`;
  const actBody = `Акт-предписание по нарушению №${num}.

Объект: ${obj?.name || '—'}
Подрядчик: ${org?.name || '—'}

Во вложении: акт-предписание (DOCX) и фото (${wizard.media?.length || 0} шт.).

Visural Audit`;

  return {
    subject: alertSubject,
    body: `--- Письмо 1: уведомление ---\n${alertBody}\n\n--- Письмо 2: акт ---\n${actBody}`,
    to: org?.email || '',
  };
}

/** Открывает Gmail с готовым письмом — бесплатно, любой получатель, без настройки */
function openGmailCompose(to, subject, body) {
  const safeBody = String(body || '').length > 6000 ? String(body).slice(0, 6000) + '…' : body;
  const params = new URLSearchParams({
    view: 'cm',
    fs: '1',
    to: to || '',
    su: subject || '',
    body: safeBody || '',
  });
  const url = `https://mail.google.com/mail/?${params.toString()}`;
  const opened = window.open(url, '_blank');
  if (!opened) window.location.href = url;
}

function openEmailClient(to, subject, body) {
  openGmailCompose(to, subject, body);
}

function openEmailEasy(to, subject, body) {
  if (!to || !to.includes('@')) return false;
  openGmailCompose(to, subject, body);
  return true;
}
