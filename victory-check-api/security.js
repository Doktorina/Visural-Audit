/**
 * Хеширование паролей Argon2id (с поддержкой старых bcrypt / plaintext при входе)
 */
const argon2 = require('argon2');
const bcrypt = require('bcryptjs');

const ARGON_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 3,
  parallelism: 1,
};

async function hashPassword(plain) {
  return argon2.hash(String(plain), ARGON_OPTS);
}

async function verifyPassword(record, plain) {
  const hash = record?.passwordHash || record?.password;
  if (!hash || plain == null) return { ok: false, upgrade: false };

  const pwd = String(plain);

  if (hash.startsWith('$argon2')) {
    try {
      const ok = await argon2.verify(hash, pwd);
      return { ok, upgrade: false };
    } catch {
      return { ok: false, upgrade: false };
    }
  }

  if (hash.startsWith('$2')) {
    const ok = await bcrypt.compare(pwd, hash);
    return { ok, upgrade: ok };
  }

  const ok = hash === pwd;
  return { ok, upgrade: ok };
}

function isSecureHash(hash) {
  return typeof hash === 'string' && hash.startsWith('$argon2');
}

module.exports = {
  hashPassword,
  verifyPassword,
  isSecureHash,
};
