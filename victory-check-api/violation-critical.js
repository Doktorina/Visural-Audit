/** Критическое = до истечения срока осталось не более 2 суток (и срок ещё не прошёл) */
const CRITICAL_BEFORE_MS = 2 * 24 * 60 * 60 * 1000;

function isOpenViolation(v) {
  if (!v) return false;
  return v.status !== 'resolved' && v.status !== 'verification';
}

function isDeadlineCritical(v, now = new Date()) {
  if (!v?.deadline || !isOpenViolation(v)) return false;
  const msLeft = new Date(v.deadline) - now;
  if (msLeft < 0) return false;
  return msLeft <= CRITICAL_BEFORE_MS;
}

module.exports = {
  CRITICAL_BEFORE_MS,
  isOpenViolation,
  isDeadlineCritical,
};
