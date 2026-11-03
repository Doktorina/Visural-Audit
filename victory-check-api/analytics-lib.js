/**
 * Аналитика нарушений — фильтры, тренды, сравнение периодов
 */

const SEVERITY_GROUPS = {
  major: ['major'],
  minor: ['minor', 'recommendation'],
};

function parseDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function datePreset(preset) {
  const now = new Date();
  const to = endOfDay(now);
  let from = startOfDay(now);
  switch (preset) {
    case 'today':
      break;
    case 'week':
      from.setDate(from.getDate() - 6);
      break;
    case 'month':
      from.setMonth(from.getMonth() - 1);
      from.setDate(from.getDate() + 1);
      break;
    case 'quarter':
      from.setMonth(from.getMonth() - 3);
      from.setDate(from.getDate() + 1);
      break;
    case 'year':
      from.setFullYear(from.getFullYear() - 1);
      from.setDate(from.getDate() + 1);
      break;
    default:
      return null;
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

function parseFilters(searchParams) {
  const preset = searchParams.get('preset');
  const presetRange = preset ? datePreset(preset) : null;
  const from = searchParams.get('from') || presetRange?.from || null;
  const to = searchParams.get('to') || presetRange?.to || null;
  return {
    from,
    to,
    preset: preset || '',
    statusGroup: searchParams.get('status') || 'all',
    severity: searchParams.get('severity') || 'all',
    createdByUserIds: (searchParams.get('users') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    search: (searchParams.get('search') || '').trim().toLowerCase(),
    contractorIds: (searchParams.get('contractors') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    objectIds: (searchParams.get('objects') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    categoryIds: (searchParams.get('categories') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    groupBy: searchParams.get('groupBy') || 'category',
    sortBy: searchParams.get('sortBy') || 'count',
    includeViolations: searchParams.get('includeViolations') === '1',
    drillCategory: searchParams.get('drillCategory') || '',
    drillContractor: searchParams.get('drillContractor') || '',
  };
}

function isResolvedStatus(status) {
  return status === 'resolved' || status === 'verification';
}

function matchesStatusGroup(v, group, isOverdueFn) {
  if (group === 'all') return true;
  if (group === 'resolved') return isResolvedStatus(v.status);
  if (group === 'unresolved') return !isResolvedStatus(v.status) && v.status !== 'overdue' && !isOverdueFn(v);
  if (group === 'overdue') return v.status === 'overdue' || isOverdueFn(v);
  return v.status === group;
}

function matchesSeverity(v, group, isDeadlineCriticalFn) {
  if (group === 'all') return true;
  if (group === 'critical') return isDeadlineCriticalFn(v);
  if (group === 'major') return v.severity === 'major';
  if (group === 'minor') return v.severity === 'minor' || v.severity === 'recommendation';
  return v.severity === group;
}

function filterViolations(items, filters, isOverdueFn, isDeadlineCriticalFn) {
  const critFn = isDeadlineCriticalFn || (() => false);
  let list = [...items];
  const from = parseDate(filters.from);
  const to = parseDate(filters.to);
  if (from) list = list.filter((v) => new Date(v.createdAt) >= from);
  if (to) list = list.filter((v) => new Date(v.createdAt) <= to);
  list = list.filter((v) => matchesStatusGroup(v, filters.statusGroup, isOverdueFn));
  list = list.filter((v) => matchesSeverity(v, filters.severity, critFn));
  if (filters.contractorIds.length) {
    list = list.filter((v) => filters.contractorIds.includes(v.contractorId));
  }
  if (filters.objectIds.length) {
    list = list.filter((v) => filters.objectIds.includes(v.objectId));
  }
  if (filters.categoryIds.length) {
    list = list.filter((v) => filters.categoryIds.includes(v.categoryId));
  }
  if (filters.drillCategory) {
    list = list.filter((v) => v.categoryId === filters.drillCategory);
  }
  if (filters.drillContractor) {
    list = list.filter((v) => v.contractorId === filters.drillContractor);
  }
  if (filters.createdByUserIds?.length) {
    const ids = new Set(filters.createdByUserIds);
    list = list.filter((v) => ids.has(v.createdByUserId));
  }
  if (filters.search) {
    const q = filters.search;
    list = list.filter((v) => {
      const hay = [v.number, v.description, v.responsible, v.createdByName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }
  return list;
}

function periodMs(from, to) {
  const f = parseDate(from);
  const t = parseDate(to);
  if (!f || !t) return 30 * 86400000;
  return Math.max(86400000, t - f + 1);
}

function previousPeriod(from, to) {
  const f = parseDate(from);
  const t = parseDate(to);
  if (!f || !t) return { from: null, to: null };
  const len = periodMs(from, to);
  const prevTo = new Date(f.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - len + 1);
  return { from: prevFrom.toISOString(), to: prevTo.toISOString() };
}

function trendByDay(items) {
  const map = {};
  items.forEach((v) => {
    const key = (v.createdAt || '').slice(0, 10);
    if (!key) return;
    map[key] = (map[key] || 0) + 1;
  });
  return Object.entries(map)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));
}

function groupItems(items, groupBy, db, categories, isDeadlineCriticalFn) {
  const critFn = isDeadlineCriticalFn || (() => false);
  const map = {};
  items.forEach((v) => {
    let key;
    let label;
    let id;
    if (groupBy === 'contractor') {
      id = v.contractorId;
      const c = db.contractors.find((x) => x.id === id);
      label = c?.name || '—';
      key = id || 'none';
    } else if (groupBy === 'object') {
      id = v.objectId;
      const o = db.objects.find((x) => x.id === id);
      label = o?.name || '—';
      key = id || 'none';
    } else if (groupBy === 'severity') {
      id = v.severity;
      const labels = {
        critical: 'Критическое',
        major: 'Значительное',
        minor: 'Незначительное',
        recommendation: 'Рекомендация',
      };
      label = labels[v.severity] || v.severity;
      key = v.severity;
    } else {
      id = v.categoryId;
      const cat = categories.find((c) => c.id === id);
      label = cat?.name || 'Другое';
      key = id || 'other';
    }
    if (!map[key]) map[key] = { id, name: label, count: 0, critical: 0, overdue: 0 };
    map[key].count += 1;
    if (critFn(v)) map[key].critical += 1;
    if (v.status === 'overdue') map[key].overdue += 1;
  });
  return Object.values(map);
}

function sortGroups(groups, sortBy) {
  const copy = [...groups];
  if (sortBy === 'name') {
    copy.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  } else if (sortBy === 'severity') {
    copy.sort((a, b) => b.critical - a.critical || b.count - a.count);
  } else {
    copy.sort((a, b) => b.count - a.count);
  }
  return copy;
}

function slimViolation(v, db, categories) {
  const obj = db.objects.find((o) => o.id === v.objectId);
  const con = db.contractors.find((c) => c.id === v.contractorId);
  const cat = categories.find((c) => c.id === v.categoryId);
  return {
    id: v.id,
    number: v.number,
    description: v.description,
    status: v.status,
    severity: v.severity,
    createdAt: v.createdAt,
    deadline: v.deadline,
    objectId: v.objectId,
    objectName: obj?.name || '—',
    contractorId: v.contractorId,
    contractorName: con?.name || '—',
    categoryId: v.categoryId,
    categoryName: cat?.name || 'Другое',
  };
}

function computeAnalytics(db, allViolations, filters, categories, helpers) {
  const { applyOverdue, isOverdue, isDeadlineCritical } = helpers;
  const critFn = isDeadlineCritical || (() => false);
  const withOverdue = allViolations.map(applyOverdue);
  const items = filterViolations(withOverdue, filters, isOverdue, critFn);

  const resolved = items.filter((v) => isResolvedStatus(v.status)).length;
  const overdue = items.filter((v) => v.status === 'overdue' || isOverdue(v)).length;
  const critical = items.filter((v) => critFn(v)).length;

  const byCategory = {};
  const byOrg = {};
  items.forEach((v) => {
    const cat = categories.find((c) => c.id === v.categoryId);
    const catName = cat?.name || 'Другое';
    const catId = v.categoryId || 'other';
    if (!byCategory[catId]) byCategory[catId] = { id: catId, name: catName, count: 0 };
    byCategory[catId].count += 1;
    const org = db.contractors.find((c) => c.id === v.contractorId)?.name || '—';
    const orgId = v.contractorId || 'none';
    if (!byOrg[orgId]) byOrg[orgId] = { id: orgId, name: org, count: 0 };
    byOrg[orgId].count += 1;
  });

  const prev = previousPeriod(filters.from, filters.to);
  const prevFilters = { ...filters, from: prev.from, to: prev.to, drillCategory: '', drillContractor: '' };
  const prevItems = filterViolations(withOverdue, prevFilters, isOverdue, critFn);
  const prevTotal = prevItems.length;
  const prevResolved = prevItems.filter((v) => isResolvedStatus(v.status)).length;
  const prevOverdue = prevItems.filter((v) => v.status === 'overdue' || isOverdue(v)).length;
  const prevCritical = prevItems.filter((v) => critFn(v)).length;

  const pct = (cur, prev) => (prev ? Math.round(((cur - prev) / prev) * 100) : cur ? 100 : 0);

  const groups = sortGroups(groupItems(items, filters.groupBy, db, categories, critFn), filters.sortBy);

  const trend = trendByDay(items);

  const result = {
    filters: {
      from: filters.from,
      to: filters.to,
      preset: filters.preset,
      statusGroup: filters.statusGroup,
      severity: filters.severity,
      groupBy: filters.groupBy,
      sortBy: filters.sortBy,
    },
    period: {
      from: filters.from,
      to: filters.to,
      label: formatPeriodLabel(filters.from, filters.to, filters.preset),
    },
    total: items.length,
    resolved,
    resolvedPct: items.length ? Math.round((resolved / items.length) * 100) : 0,
    overdue,
    critical,
    comparison: {
      previousTotal: prevTotal,
      delta: items.length - prevTotal,
      deltaPct: pct(items.length, prevTotal),
      previousResolved: prevResolved,
      resolvedDelta: resolved - prevResolved,
      resolvedDeltaPct: pct(resolved, prevResolved),
      previousOverdue: prevOverdue,
      overdueDelta: overdue - prevOverdue,
      overdueDeltaPct: pct(overdue, prevOverdue),
      previousCritical: prevCritical,
      criticalDelta: critical - prevCritical,
      criticalDeltaPct: pct(critical, prevCritical),
      previousFrom: prev.from,
      previousTo: prev.to,
    },
    byCategory: Object.values(byCategory).sort((a, b) => b.count - a.count),
    topOrganizations: Object.values(byOrg)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    groups,
    trend,
    recent: [...items]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10)
      .map((v) => slimViolation(v, db, categories)),
  };

  if (filters.includeViolations || filters.drillCategory || filters.drillContractor) {
    result.violations = [...items]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((v) => slimViolation(v, db, categories));
  }

  return result;
}

function formatPeriodLabel(from, to, preset) {
  const labels = {
    today: 'Сегодня',
    week: 'Неделя',
    month: 'Месяц',
    quarter: 'Квартал',
    year: 'Год',
  };
  if (preset && labels[preset]) return labels[preset];
  const f = parseDate(from);
  const t = parseDate(to);
  if (f && t) {
    return `${f.toLocaleDateString('ru-RU')} — ${t.toLocaleDateString('ru-RU')}`;
  }
  return 'Всё время';
}

function violationsToCsv(violations) {
  const header = ['№', 'Дата', 'Объект', 'Организация', 'Категория', 'Критичность', 'Статус', 'Описание', 'Срок'];
  const rows = violations.map((v) => [
    v.number,
    v.createdAt ? new Date(v.createdAt).toLocaleDateString('ru-RU') : '',
    v.objectName,
    v.contractorName,
    v.categoryName,
    v.severity,
    v.status,
    (v.description || '').replace(/"/g, '""'),
    v.deadline ? new Date(v.deadline).toLocaleDateString('ru-RU') : '',
  ]);
  const lines = [header, ...rows].map((r) => r.map((c) => `"${String(c ?? '')}"`).join(';'));
  return '\uFEFF' + lines.join('\r\n');
}

module.exports = {
  parseFilters,
  datePreset,
  computeAnalytics,
  violationsToCsv,
  SEVERITY_GROUPS,
};
