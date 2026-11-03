const SEVERITY_LABELS = {
  critical: 'Критическое',
  major: 'Значительное',
  minor: 'Незначительное',
  recommendation: 'Рекомендация',
};

const SEVERITY_EMOJI = {
  critical: '🔴',
  major: '🟡',
  minor: '🟢',
  recommendation: '⚪',
};

const CATEGORY_FULL = {
  ppe: 'СИЗ (Средства индивидуальной защиты)',
  electro: 'Электробезопасность',
  height: 'Работа на высоте',
  fire: 'Пожарная безопасность',
};

function formatDateRu(iso) {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatDeadlineRu(iso) {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDeadlinePush(iso) {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `сегодня до ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `завтра до ${time}`;
  return formatDeadlineRu(iso);
}

function truncatePush(text, max = 100) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + '…';
}

function getViolationContext(violation, db, categories) {
  const category = categories.find((c) => c.id === violation.categoryId);
  const customOther =
    violation.categoryId === 'other' && violation.categoryOther
      ? String(violation.categoryOther).trim()
      : '';
  return {
    violation,
    object: db.objects.find((o) => o.id === violation.objectId),
    contractor: db.contractors.find((c) => c.id === violation.contractorId),
    category: customOther ? { id: 'other', name: customOther } : category,
    categoryFull:
      customOther ||
      CATEGORY_FULL[violation.categoryId] ||
      category?.name ||
      '—',
  };
}

function buildPushAssigned(ctx) {
  const v = ctx.violation;
  const head = `📋 Вам назначено нарушение №${v.number}`;
  const lines = [
    head,
    `${ctx.object?.name || '—'} • ${ctx.contractor?.name || '—'}`,
    `Устранить до: ${formatDeadlinePush(v.deadline)}`,
    v.description ? String(v.description).trim().slice(0, 100) : '',
  ].filter(Boolean);
  const body = lines.join('\n');
  return {
    channel: 'push',
    type: 'violation_assigned',
    title: truncatePush(head, 100),
    message: truncatePush(lines.slice(0, 3).join('\n'), 120),
    body,
    actionLabel: 'Исправить',
  };
}

function buildPushNew(ctx) {
  const v = ctx.violation;
  const head = `⚠️ Новое нарушение №${v.number}`;
  const lines = [
    head,
    `${ctx.object?.name || '—'} • ${ctx.contractor?.name || '—'}`,
    `Срок: ${formatDeadlinePush(v.deadline)}`,
    '[Открыть]',
  ];
  const body = lines.join('\n');
  return {
    channel: 'push',
    type: 'violation_new',
    title: truncatePush(head, 100),
    message: truncatePush(`${lines[0]}\n${lines[1]}\n${lines[2]}`, 100),
    body,
    actionLabel: 'Открыть',
  };
}

function buildPushResolved(ctx, reporterName) {
  const v = ctx.violation;
  const lines = [
    `📋 Отчёт по №${v.number} — на проверке`,
    `${reporterName || 'Подрядчик'} отправил отчёт об устранении`,
    'Проверьте и измените статус',
  ];
  const body = lines.join('\n');
  return {
    channel: 'push',
    type: 'violation_resolved',
    title: truncatePush(lines[0], 100),
    message: truncatePush(`${lines[0]}\n${lines[1]}`, 100),
    body,
    actionLabel: 'Проверить',
  };
}

function buildEmailAlert(ctx, recipientName) {
  const v = ctx.violation;
  const subject = `[Visural Audit] Новое нарушение №${v.number}`;
  const body = `Здравствуйте, ${recipientName || 'коллега'}!

Зарегистрировано новое нарушение №${v.number} на объекте «${ctx.object?.name || '—'}».

Акт-предписание будет отправлен отдельным письмом.

Visural Audit`;

  return {
    channel: 'email',
    type: 'violation_new',
    subject,
    body,
    title: subject,
    message: `Новое нарушение №${v.number}`,
    actionLabel: 'Открыть в приложении',
  };
}

function buildEmailAct(ctx, prescriptionNum) {
  const v = ctx.violation;
  const num = prescriptionNum || v.prescriptionNumber || '—';
  const photoCount = Array.isArray(v.media) ? v.media.length : 0;
  const subject = `[Visural Audit] Акт-предписание №${num} — ${v.number}`;
  const body = `Акт-предписание по нарушению №${v.number}.

Объект: ${ctx.object?.name || '—'}
Подрядчик: ${ctx.contractor?.name || '—'}

Во вложении: акт-предписание (DOCX) и фото (${photoCount} шт.).

Visural Audit`;

  return {
    channel: 'email',
    type: 'violation_prescription',
    subject,
    body,
    title: subject,
    message: `Акт-предписание №${num}`,
    actionLabel: 'Скачать предписание',
  };
}

function buildEmailNew(ctx, recipientName) {
  return buildEmailAlert(ctx, recipientName);
}

function buildEmailResolved(ctx, recipientName, reporterName) {
  const v = ctx.violation;
  const subject = `[Visural Audit] Отчёт по нарушению №${v.number} — на проверке`;
  const body = `Здравствуйте, ${recipientName || 'коллега'}!

По нарушению №${v.number} подрядчик отправил отчёт об устранении.

Исполнитель: ${reporterName || v.responsible}
Объект: ${ctx.object?.name || '—'}
Подрядчик: ${ctx.contractor?.name || '—'}

Откройте нарушение в приложении, проверьте комментарии и фото, затем измените статус.

[Проверить в приложении]

С уважением,
Система Visural Audit`;

  return {
    channel: 'email',
    type: 'violation_resolved',
    subject,
    body,
    title: subject,
    message: `Отчёт по №${v.number} — проверьте устранение`,
    actionLabel: 'Проверить',
  };
}

function buildEmailReportRejected(ctx, recipientName, reason, actorName) {
  const v = ctx.violation;
  const subject = `[Visural Audit] Отчёт отклонён — №${v.number}`;
  const body = `Здравствуйте, ${recipientName || 'коллега'}!

Отчёт об устранении по нарушению №${v.number} отклонён.

Кто отклонил: ${actorName || 'Администратор'}
Причина: ${reason || '—'}
Объект: ${ctx.object?.name || '—'}

Исправьте замечания и отправьте отчёт повторно в приложении Visural Audit.

С уважением,
Система Visural Audit`;

  return {
    channel: 'email',
    type: 'report_rejected',
    subject,
    body,
    title: subject,
    message: `Отчёт по №${v.number} отклонён`,
    actionLabel: 'Открыть',
  };
}

function buildEmailDeadlineApproaching(ctx, recipientName) {
  const v = ctx.violation;
  const subject = `[Visural Audit] До срока устранения менее 2 суток — №${v.number}`;
  const body = `Здравствуйте, ${recipientName || 'коллега'}!

До истечения срока устранения нарушения №${v.number} осталось менее 2 суток (срок: ${formatDeadlineRu(v.deadline)}).

Объект: ${ctx.object?.name || '—'}
Подрядчик: ${ctx.contractor?.name || '—'}
Описание: ${v.description || '—'}

Пожалуйста, устраните нарушение до указанного срока.

С уважением,
Система Visural Audit`;

  return {
    channel: 'email',
    type: 'deadline_approaching',
    subject,
    body,
    title: subject,
    message: `Срок скоро: №${v.number}`,
    actionLabel: 'Открыть в приложении',
  };
}

function buildEmailDeadlineExpired(ctx, recipientName) {
  const v = ctx.violation;
  const subject = `[Visural Audit] Срок устранения истёк — нарушение №${v.number}`;
  const body = `Здравствуйте, ${recipientName || 'коллега'}!

Срок устранения нарушения №${v.number} истёк (${formatDeadlineRu(v.deadline)}).

Объект: ${ctx.object?.name || '—'}
Подрядчик: ${ctx.contractor?.name || '—'}
Описание: ${v.description || '—'}

Нарушение не устранено в установленный срок. Примите меры и обновите статус в приложении Visural Audit.

С уважением,
Система Visural Audit`;

  return {
    channel: 'email',
    type: 'deadline_expired',
    subject,
    body,
    title: subject,
    message: `Срок истёк: №${v.number}`,
    actionLabel: 'Открыть в приложении',
  };
}

function buildTelegramNew(ctx) {
  const v = ctx.violation;
  const sevEmoji = SEVERITY_EMOJI[v.severity] || '🟡';
  const sevLabel = SEVERITY_LABELS[v.severity] || v.severity;
  const text = [
    `${sevEmoji} Новое нарушение №${v.number}`,
    '',
    `Объект: ${ctx.object?.name || '—'}`,
    `Подрядчик: ${ctx.contractor?.name || '—'}`,
    `Категория: ${ctx.categoryFull}`,
    `Степень: ${sevLabel}`,
    `Срок: ${formatDeadlineRu(v.deadline)}`,
    '',
    `Описание: ${v.description}`,
    '',
    'Visural Audit',
  ].join('\n');
  return { channel: 'telegram', type: 'violation_new', text, title: `№${v.number}`, message: text };
}

function buildTelegramResolved(ctx, reporterName) {
  const v = ctx.violation;
  const text = [
    `✅ Отчёт по нарушению №${v.number}`,
    '',
    `Исполнитель: ${reporterName || v.responsible}`,
    `Объект: ${ctx.object?.name || '—'}`,
    '',
    'Требуется проверка. Visural Audit',
  ].join('\n');
  return { channel: 'telegram', type: 'violation_resolved', text, title: `№${v.number}`, message: text };
}

function buildForEvent(event, ctx, options = {}) {
  const { actorName, recipientName } = options;
  if (event === 'created') {
    // В ленте — одно push-уведомление; письма уходят отдельно через SMTP
    return [buildPushNew(ctx)];
  }
  if (event === 'report') {
    return [
      buildPushResolved(ctx, actorName),
      buildEmailResolved(ctx, recipientName || 'Аудитор', actorName),
    ];
  }
  return [];
}

function toDbNotification(template, violationId, userId) {
  return {
    id: 'n' + Date.now() + Math.random().toString(36).slice(2, 6),
    userId: userId || null,
    violationId,
    channel: template.channel,
    type: template.type,
    title: template.title,
    message: template.message,
    subject: template.subject || null,
    body: template.body,
    actionLabel: template.actionLabel || null,
    isRead: false,
    read: false,
    createdAt: new Date().toISOString(),
    at: new Date().toISOString(),
  };
}

function enqueueNotifications(db, violation, event, options, categories) {
  const ctx = getViolationContext(violation, db, categories);
  const templates = buildForEvent(event, ctx, options);
  const userIds = [...new Set((options.notifyUserIds || [options.userId]).filter(Boolean))];
  templates.forEach((t) => {
    userIds.forEach((userId) => {
      db.notifications.unshift(toDbNotification(t, violation.id, userId));
    });
  });
}

function enqueueAssigneeNotification(db, violation, categories, responsibleUserId) {
  const uid = String(responsibleUserId || '').trim();
  if (!uid) return;
  const ctx = getViolationContext(violation, db, categories);
  const t = buildPushAssigned(ctx);
  db.notifications.unshift(toDbNotification(t, violation.id, uid));
}

function preview(violation, db, categories, event = 'created') {
  const ctx = getViolationContext(violation, db, categories);
  return {
    push: buildPushNew(ctx),
    email: buildEmailNew(ctx, violation.responsible),
    report: {
      push: buildPushResolved(ctx, 'Иванов И.И.'),
      email: buildEmailResolved(ctx, violation.responsible, 'Иванов И.И.'),
    },
  };
}

module.exports = {
  enqueueNotifications,
  preview,
  buildPushNew,
  buildPushAssigned,
  enqueueAssigneeNotification,
  buildEmailNew,
  buildEmailAlert,
  buildEmailAct,
  buildPushResolved,
  buildEmailResolved,
  buildEmailReportRejected,
  buildEmailDeadlineApproaching,
  buildEmailDeadlineExpired,
  buildTelegramNew,
  buildTelegramResolved,
  getViolationContext,
  truncatePush,
};
