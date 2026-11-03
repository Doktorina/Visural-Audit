/** Матрица каналов по ролям (п. 2.2.3.4) */

const ROLE_MATRIX = {
  safety_officer: {
    label: 'Safety Officer (Инспектор)',
    push: true,
    email: true,
    messenger: true,
    sms: false,
  },
  contractor: {
    label: 'Ответственный (Подрядчик)',
    push: true,
    email: true,
    messenger: true,
    sms: true,
  },
  contractor_manager: {
    label: 'Руководитель подрядчика',
    push: false,
    email: true,
    messenger: true,
    sms: false,
  },
  object_manager: {
    label: 'Руководитель объекта',
    push: true,
    email: true,
    messenger: true,
    sms: false,
  },
  admin: {
    label: 'Администратор системы',
    push: true,
    email: true,
    messenger: false,
    sms: false,
  },
  supervisor: {
    label: 'Супервизор (Топ-менеджмент)',
    push: false,
    email: true,
    messenger: false,
    sms: false,
  },
};

const ROLE_ALIAS = {
  auditor: 'safety_officer',
  inspector: 'safety_officer',
  safety_officer: 'safety_officer',
  contractor: 'contractor',
  responsible: 'contractor',
  contractor_manager: 'contractor_manager',
  object_manager: 'object_manager',
  manager: 'object_manager',
  admin: 'admin',
  supervisor: 'supervisor',
};

const DEFAULT_NOTIFY_SETTINGS = {
  push: {
    newViolation: true,
    statusChange: true,
    deadlineNear: true,
    comments: true,
    system: true,
  },
  email: {
    newViolation: true,
    prescriptions: true,
    dailyDigest: true,
    weeklyReport: true,
    marketing: false,
  },
  messenger: {
    all: true,
    criticalOnly: false,
  },
  sms: {
    criticalOnly: true,
  },
  quietHours: {
    enabled: true,
    from: '22:00',
    to: '07:00',
    criticalOnly: true,
  },
};

function resolveRoleKey(role) {
  return ROLE_ALIAS[role] || role || 'safety_officer';
}

function getRoleMatrix(role) {
  const key = resolveRoleKey(role);
  return ROLE_MATRIX[key] || ROLE_MATRIX.safety_officer;
}

function mergeSettings(stored) {
  const s = JSON.parse(JSON.stringify(DEFAULT_NOTIFY_SETTINGS));
  if (!stored) return s;
  ['push', 'email', 'messenger', 'sms', 'quietHours'].forEach((k) => {
    if (stored[k] && typeof stored[k] === 'object') Object.assign(s[k], stored[k]);
  });
  return s;
}

function canUseChannel(role, channel) {
  const m = getRoleMatrix(role);
  return !!m[channel];
}

function shouldNotify(settings, channel, event) {
  if (!settings) return true;
  if (channel === 'push') {
    if (event === 'violation_new' || event === 'violation_assigned') {
      return settings.push?.newViolation !== false;
    }
    if (event === 'status_changed') return settings.push?.statusChange !== false;
    if (event === 'deadline_approaching') return settings.push?.deadlineNear !== false;
    if (event === 'comment') return settings.push?.comments !== false;
    return settings.push?.system !== false;
  }
  if (channel === 'email') {
    if (event === 'violation_new') return settings.email?.newViolation !== false;
    if (event === 'prescription') return settings.email?.prescriptions !== false;
    return settings.email?.newViolation !== false;
  }
  if (channel === 'messenger') {
    if (settings.messenger?.criticalOnly) return event === 'violation_critical';
    return settings.messenger?.all !== false;
  }
  if (channel === 'sms') {
    return settings.sms?.criticalOnly && event === 'violation_critical';
  }
  return true;
}

module.exports = {
  ROLE_MATRIX,
  DEFAULT_NOTIFY_SETTINGS,
  resolveRoleKey,
  getRoleMatrix,
  mergeSettings,
  canUseChannel,
  shouldNotify,
};
