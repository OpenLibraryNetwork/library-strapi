'use strict';

/**
 * Text normalization for search and duplicate detection.
 * "Λοϊζίδη, Νίκη" → "λοιζιδη νικη"
 */

function normalize(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokenize(text) {
  const normalized = normalize(text);
  return normalized ? normalized.split(' ') : [];
}

function buildSearchKey(...parts) {
  return normalize(parts.filter((p) => p !== null && p !== undefined && p !== '').join(' '));
}

// "τεύχ. 05", "Τεύχος5", "Νο 5", "Nº 5", "N° 5", "Τ. 5" → "5"; "12 - 13" → "12 13"
const ISSUE_PREFIX = /^(?:τευχοσ|τευχ|τχ|τ|νο|no|nr|n|αρ|αριθμοσ)\s*(?=\d)/;

function normalizeIssueNumber(text) {
  // NFKD first: "º" (ordinal indicator) becomes "o"
  const compatible = text === null || text === undefined ? text : String(text).normalize('NFKD');
  return normalize(compatible).replace(ISSUE_PREFIX, '').replace(/(^|\s)0+(\d)/g, '$1$2');
}

// Sort key of an issue: the first number of its normalized issue number ("τχ. 05" → 5, "12-13" → 12); 0 without one.
function issueOrderOf(text) {
  const match = normalizeIssueNumber(text).match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function buildMatchKey(kind, fields) {
  switch (kind) {
    case 'person':
    case 'publisher':
      return `${normalize(fields.name)}|${normalize(fields.qualifier)}`;
    case 'brochure':
      return `${normalize(fields.title)}|${fields.publisherId ?? ''}|${fields.yearPublished ?? ''}`;
    case 'magazine':
      return `${normalize(fields.title)}|${normalize(fields.qualifier)}`;
    case 'issue': {
      const number = normalizeIssueNumber(fields.issueNumber);
      return number
        ? `${fields.magazineId ?? ''}|n:${number}`
        : `${fields.magazineId ?? ''}|p:${normalize(fields.period)}`;
    }
    default:
      throw new Error(`Unknown match key kind: ${kind}`);
  }
}

module.exports = { normalize, tokenize, buildSearchKey, buildMatchKey, normalizeIssueNumber, issueOrderOf };
