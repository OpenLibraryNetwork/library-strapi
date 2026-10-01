'use strict';

/**
 * True when an error comes from a unique constraint, either from Strapi's validator
 * ("This attribute must be unique") or from the database (SQLite / Postgres).
 */
function isUniqueViolation(err) {
  if (!err) return false;
  if (err.code === '23505' || err.code === 'SQLITE_CONSTRAINT_UNIQUE') return true;
  return /unique/i.test(err.message || '');
}

module.exports = { isUniqueViolation };
