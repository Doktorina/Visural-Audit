/** Права доступа по ролям */

const projectScope = require('./project-scope');

const ROLE_LABELS = {
  admin: 'Администратор',
  auditor: 'Аудитор',
  contractor: 'Подрядчик',
  viewer: 'Наблюдатель',
};

const PERMS = {
  admin: {
    adminPanel: true,
    createViolation: true,
    editStatus: true,
    comment: true,
    report: true,
    manageDirectories: true,
    share: true,
    viewAllViolations: true,
  },
  auditor: {
    adminPanel: false,
    createViolation: true,
    editStatus: true,
    comment: true,
    report: true,
    manageDirectories: true,
    share: true,
    viewAllViolations: true,
  },
  contractor: {
    adminPanel: false,
    createViolation: false,
    editStatus: false,
    comment: true,
    report: true,
    manageDirectories: false,
    share: false,
    viewAllViolations: false,
  },
  viewer: {
    adminPanel: false,
    createViolation: false,
    editStatus: false,
    comment: false,
    report: true,
    manageDirectories: false,
    share: false,
    viewAllViolations: false,
  },
};

function normalizeRole(role) {
  const r = String(role || 'viewer').toLowerCase();
  if (PERMS[r]) return r;
  if (r === 'inspector' || r === 'safety_officer') return 'auditor';
  if (r === 'responsible') return 'contractor';
  return 'viewer';
}

function isClosedStatus(status) {
  const s = String(status || '').toLowerCase();
  return s === 'resolved';
}

function getPermissions(role, userStatus) {
  const r = normalizeRole(role);
  const p = { ...PERMS[r] };
  const status = String(userStatus || 'active').toLowerCase();
  if (status === 'pending' || status === 'rejected') {
    return {
      adminPanel: false,
      createViolation: false,
      editStatus: false,
      comment: false,
      report: false,
      manageDirectories: false,
      share: false,
      viewAllViolations: false,
    };
  }
  if (r === 'viewer' && status === 'active') {
    p.viewAllViolations = true;
  }
  return p;
}

function isAccountPending(user) {
  return String(user?.status || 'active').toLowerCase() === 'pending';
}

function isAccountRejected(user) {
  return String(user?.status || 'active').toLowerCase() === 'rejected';
}

function can(user, action) {
  if (!user) return false;
  const p = getPermissions(user.role, user.status);
  return !!p[action];
}

function isTrainingContractorViolation(violation) {
  return String(violation?.description || '').includes('[TRAINING_CONTRACTOR]');
}

function isTrainingPracticeViolation(violation) {
  return String(violation?.description || '').includes('[TRAINING_PRACTICE]');
}

function isTrainingViolation(violation) {
  return isTrainingContractorViolation(violation) || isTrainingPracticeViolation(violation);
}

function isTrainingViolationForUser(user, violation) {
  if (!user || !violation || !isTrainingContractorViolation(violation)) return false;
  return String(violation.responsibleUserId || '') === String(user.id || '');
}

function canAccessViolation(user, violation) {
  if (!user || !violation) return false;
  if (isAccountPending(user) || isAccountRejected(user)) return false;
  if (isTrainingContractorViolation(violation)) {
    if (can(user, 'viewAllViolations')) return true;
    return isTrainingViolationForUser(user, violation);
  }
  if (can(user, 'viewAllViolations')) return true;
  if (user.contractorId || user.company) {
    return projectScope.userLinkedToViolation(user, violation);
  }
  return false;
}

function filterViolations(user, violations) {
  if (!user) return [];
  if (isAccountPending(user) || isAccountRejected(user)) return [];
  if (can(user, 'viewAllViolations')) {
    return violations.filter((v) => !isTrainingContractorViolation(v));
  }
  if (user.contractorId || user.company) {
    return violations.filter(
      (v) => isTrainingViolationForUser(user, v) || projectScope.userLinkedToViolation(user, v)
    );
  }
  return [];
}

function excludeTrainingFromAnalytics(violations) {
  return (violations || []).filter((v) => !isTrainingViolation(v));
}

module.exports = {
  ROLE_LABELS,
  getPermissions,
  can,
  canAccessViolation,
  filterViolations,
  isTrainingContractorViolation,
  isTrainingPracticeViolation,
  isTrainingViolation,
  isTrainingViolationForUser,
  excludeTrainingFromAnalytics,
  normalizeRole,
  isAccountPending,
  isAccountRejected,
  isClosedStatus,
};
