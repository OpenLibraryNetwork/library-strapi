'use strict';

/**
 * ISBN normalization. Canonical storage form: ISBN-13, digits only.
 */

function isValidIsbn13(s) {
  if (!/^\d{13}$/.test(s)) return false;
  const sum = s
    .slice(0, 12)
    .split('')
    .reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === Number(s[12]);
}

function isValidIsbn10(s) {
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  const sum = s
    .split('')
    .reduce((acc, c, i) => acc + (c === 'X' ? 10 : Number(c)) * (10 - i), 0);
  return sum % 11 === 0;
}

function toIsbn13(isbn10) {
  const core = `978${isbn10.slice(0, 9)}`;
  const sum = core
    .split('')
    .reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return core + String((10 - (sum % 10)) % 10);
}

// Only 978-prefixed ISBN-13s have an ISBN-10 form.
function toIsbn10(isbn13) {
  if (!/^978\d{10}$/.test(isbn13)) return null;
  const core = isbn13.slice(3, 12);
  const sum = core.split('').reduce((acc, d, i) => acc + Number(d) * (10 - i), 0);
  const check = (11 - (sum % 11)) % 11;
  return core + (check === 10 ? 'X' : String(check));
}

function normalizeIsbn(raw) {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).replace(/[\s-]/g, '').toUpperCase();
  if (isValidIsbn13(cleaned)) return cleaned;
  if (isValidIsbn10(cleaned)) return toIsbn13(cleaned);
  return null;
}

module.exports = { normalizeIsbn, isValidIsbn10, isValidIsbn13, toIsbn13, toIsbn10 };
