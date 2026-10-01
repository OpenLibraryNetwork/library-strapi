'use strict';

/**
 * ISSN of serials and the EAN-13 barcode printed on them.
 * EAN-13 of a serial: 977 + first 7 ISSN digits + 2 variant digits + EAN check digit,
 * optionally followed by a 2- or 5-digit add-on (usually the issue number).
 */

const EAN_SERIAL = /^977\d{10}(\d{2}|\d{5})?$/;

function compact(raw) {
  return String(raw ?? '').toUpperCase().replace(/[\s-]/g, '');
}

function issnCheckDigit(seven) {
  let sum = 0;
  for (let i = 0; i < 7; i += 1) sum += Number(seven[i]) * (8 - i);
  const r = (11 - (sum % 11)) % 11;
  return r === 10 ? 'X' : String(r);
}

function eanCheckDigit(twelve) {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(twelve[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

/** "22415580", "2241 5580", "0000-006x" → "2241-5580" / "0000-006X"; invalid → null. */
function normalizeIssn(raw) {
  if (raw === null || raw === undefined) return null;
  const c = compact(raw);
  if (!/^\d{7}[\dX]$/.test(c)) return null;
  if (issnCheckDigit(c.slice(0, 7)) !== c[7]) return null;
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

/** Serial EAN-13 (with or without add-on) → ISSN; anything else → null. */
function issnFromEan(raw) {
  const c = compact(raw);
  if (!EAN_SERIAL.test(c)) return null;
  const ean = c.slice(0, 13);
  if (eanCheckDigit(ean.slice(0, 12)) !== ean[12]) return null;
  const seven = ean.slice(3, 10);
  return `${seven.slice(0, 4)}-${seven.slice(4)}${issnCheckDigit(seven)}`;
}

/** What the librarian typed or scanned: ISSN or serial barcode → ISSN; anything else → null. */
function parseIssnCode(raw) {
  const c = compact(raw);
  if (/^\d{13}(\d{2}|\d{5})?$/.test(c)) return issnFromEan(c);
  return normalizeIssn(raw);
}

module.exports = { normalizeIssn, issnFromEan, parseIssnCode };
