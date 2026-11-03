/** Привязка пользователей к организациям и объектам строительства */

function normalizeObjectIds(ids) {
  if (!ids) return [];
  if (Array.isArray(ids)) return ids.map((x) => String(x)).filter(Boolean);
  return [];
}

function userDisplayName(u) {
  if (!u) return '—';
  const name = `${u.firstName || ''} ${u.lastName || ''}`.trim();
  return name || u.email || '—';
}

/** ФИО для акта: Фамилия Имя Отчество */
function userFullNameLastFirst(u) {
  if (!u) return '—';
  const parts = [u.lastName, u.firstName, u.middleName || u.patronymic]
    .map((p) => String(p || '').trim())
    .filter(Boolean);
  return parts.join(' ') || userDisplayName(u);
}

/** ФИО для акта: Фамилия И.О. */
function userActPersonName(u) {
  if (!u) return '—';
  try {
    const { formatSpecialistFromUser } = require('./prescription-doc');
    return formatSpecialistFromUser(u, userFullNameLastFirst(u)).initials;
  } catch (_) {
    return userFullNameLastFirst(u);
  }
}

function normalizeOrgName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[«»"""']/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^(ооо|ао|ип|зао|пао|оао)\s+/i, '')
    .trim();
}

function contractorMatchesUser(contractor, user) {
  if (!contractor || !user) return false;
  if (user.contractorId && user.contractorId === contractor.id) return true;
  const company = normalizeOrgName(user.company);
  const name = normalizeOrgName(contractor.name);
  if (!company || !name) return false;
  return company === name || name.includes(company) || company.includes(name);
}

function findContractorByCompanyName(db, company) {
  const needle = normalizeOrgName(company);
  if (!needle) return null;
  const contractors = db.contractors || [];
  let match = contractors.find((c) => normalizeOrgName(c.name) === needle);
  if (match) return match;
  match = contractors.find((c) => {
    const name = normalizeOrgName(c.name);
    return name && (name.includes(needle) || needle.includes(name));
  });
  return match || null;
}

function searchOrganizationsByQuery(db, query, limit = 12) {
  const q = normalizeOrgName(query);
  const contractors = db.contractors || [];
  if (!q) {
    return contractors
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru'))
      .slice(0, limit)
      .map((c) => ({ id: c.id, name: c.name }));
  }
  return contractors
    .map((c) => {
      const name = String(c.name || '').trim();
      const norm = normalizeOrgName(name);
      let score = 0;
      if (norm === q) score = 100;
      else if (norm.startsWith(q) || q.startsWith(norm)) score = 85;
      else if (norm.includes(q)) score = 75;
      else if (q.includes(norm)) score = 70;
      else {
        const qWords = q.split(/\s+/).filter((w) => w.length > 1);
        const nWords = norm.split(/\s+/);
        const hits = qWords.filter((w) => nWords.some((n) => n.includes(w) || w.includes(n))).length;
        if (hits) score = 35 + hits * 12;
      }
      return { id: c.id, name, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ru'))
    .slice(0, limit)
    .map(({ id, name }) => ({ id, name }));
}

function resolveCanonicalCompanyName(db, company) {
  const match = findContractorByCompanyName(db, company);
  return match ? match.name : String(company || '').trim();
}

const SYSTEM_NOTIFY_MAILBOXES = new Set(
  [
    process.env.DEFAULT_NOTIFY_EMAIL,
    process.env.VC_ISSUER_EMAIL,
    process.env.SMTP_USER,
    'sec-work@visural.ru',
    'chudinova@visural.ru',
    'pasternak@visural.ru',
  ]
    .filter(Boolean)
    .map((e) => String(e).trim().toLowerCase())
);

function isSystemNotifyMailbox(email) {
  const addr = String(email || '').trim().toLowerCase();
  return !!(addr && SYSTEM_NOTIFY_MAILBOXES.has(addr));
}

/** Email для связи с сотрудником: регистрационный, если notify — служебный ящик */
function memberContactEmail(u) {
  const reg = String(u?.email || '').trim();
  const notify = String(u?.notifyEmail || u?.notify_email || '').trim();
  if (reg.includes('@')) {
    if (!notify || isSystemNotifyMailbox(notify)) return reg;
    return notify;
  }
  return notify || '';
}

function userCoversObject(user, objectId) {
  if (!objectId) return true;
  const ids = normalizeObjectIds(user.objectIds);
  if (!ids.length) return true;
  return ids.includes(String(objectId));
}

function isActiveUser(user) {
  return String(user?.status || 'active').toLowerCase() === 'active';
}

function userLinkedToViolation(user, violation, contractor) {
  if (!user || !violation) return false;
  if (!isActiveUser(user)) return false;
  const role = String(user.role || '').toLowerCase();
  if (role === 'admin' || role === 'auditor') return false;

  if (user.contractorId) {
    if (user.contractorId !== violation.contractorId) return false;
  } else if (contractor?.name) {
    if (!contractorMatchesUser(contractor, user)) return false;
  } else {
    return false;
  }
  return userCoversObject(user, violation.objectId);
}

function findUsersForViolation(db, violation, allUsers) {
  const contractor = (db.contractors || []).find((c) => c.id === violation.contractorId);
  const users = allUsers || db.users || [];
  return users.filter((u) => userLinkedToViolation(u, violation, contractor));
}

function findMembersForContractor(db, contractorId, objectId, allUsers) {
  const contractor = (db.contractors || []).find((c) => c.id === contractorId);
  if (!contractor) return [];
  const users = allUsers || db.users || [];
  return users.filter((u) => {
    if (!isActiveUser(u)) return false;
    if (!contractorMatchesUser(contractor, u)) return false;
    if (objectId && !userCoversObject(u, objectId)) return false;
    return true;
  });
}

const HEAD_TITLE_PATTERN =
  /(?:генеральный\s+)?директор|начальник|руководитель|управляющ|ген\.?\s*директор|ceo|director|head/i;

function isCompanyHeadJobTitle(title) {
  const t = String(title || '').trim();
  if (!t) return false;
  return HEAD_TITLE_PATTERN.test(t);
}

function isCompanyHeadUser(u) {
  return isCompanyHeadJobTitle(u?.jobTitle || u?.job_title);
}

function sortMembersHeadFirst(users) {
  return [...(users || [])].sort((a, b) => {
    const ah = isCompanyHeadUser(a);
    const bh = isCompanyHeadUser(b);
    if (ah !== bh) return ah ? -1 : 1;
    const an = userActPersonName(a).toLowerCase();
    const bn = userActPersonName(b).toLowerCase();
    return an.localeCompare(bn, 'ru');
  });
}

function resolveContractorHeadUser(contractor, db, allUsers) {
  if (!contractor) return null;
  const members = findMembersForContractor(db, contractor.id, null, allUsers);
  if (!members.length) return null;

  const byTitle = members.find(isCompanyHeadUser);
  if (byTitle) return byTitle;

  const exec = String(contractor.executor || '').trim();
  if (exec) {
    const execNorm = exec.toLowerCase();
    const byExec = members.find((u) => {
      const full = userFullNameLastFirst(u).toLowerCase();
      const display = userDisplayName(u).toLowerCase();
      const short = userActPersonName(u).toLowerCase();
      return (
        full === execNorm ||
        display === execNorm ||
        short === execNorm ||
        full.includes(execNorm) ||
        execNorm.includes(full)
      );
    });
    if (byExec) return byExec;
  }

  return sortMembersHeadFirst(members)[0] || null;
}

function formatMember(u, db) {
  const objectIds = normalizeObjectIds(u.objectIds);
  const objects = objectIds
    .map((id) => (db.objects || []).find((o) => o.id === id))
    .filter(Boolean)
    .map((o) => ({ id: o.id, name: o.name }));
  const actName = userActPersonName(u);
  const contactEmail = memberContactEmail(u);
  return {
    id: u.id,
    email: u.email || '',
    name: actName,
    displayName: actName,
    firstName: u.firstName || '',
    lastName: u.lastName || '',
    phone: u.phone || '',
    role: u.role,
    jobTitle: u.jobTitle || u.job_title || '',
    isHead: isCompanyHeadUser(u),
    contactEmail,
    notifyEmail: contactEmail,
    objectIds,
    objects,
  };
}

function emailsForUsers(users) {
  const emails = new Set();
  (users || []).forEach((u) => {
    const e = String(memberContactEmail(u) || '')
      .trim()
      .toLowerCase();
    if (e.includes('@')) emails.add(e);
  });
  return [...emails];
}

function telegramIdsForUsers(users) {
  return [...new Set((users || []).map((u) => u.telegramChatId).filter(Boolean).map(String))];
}

module.exports = {
  normalizeObjectIds,
  normalizeOrgName,
  userDisplayName,
  userFullNameLastFirst,
  userActPersonName,
  contractorMatchesUser,
  findContractorByCompanyName,
  searchOrganizationsByQuery,
  resolveCanonicalCompanyName,
  memberContactEmail,
  isSystemNotifyMailbox,
  userCoversObject,
  userLinkedToViolation,
  findUsersForViolation,
  findMembersForContractor,
  isCompanyHeadJobTitle,
  isCompanyHeadUser,
  sortMembersHeadFirst,
  resolveContractorHeadUser,
  formatMember,
  emailsForUsers,
  telegramIdsForUsers,
};
