'use strict';

/**
 * National Library of Greece catalogue (Koha): RSS search results and MARC-in-JSON records.
 * Pure functions; the HTTP part is nlg.js.
 */

const { normalizeIssn } = require('../../../utils/issn');

/** Biblionumbers in order of appearance; null when the text is not an RSS feed. */
function biblionumbersFromRss(xml) {
  if (typeof xml !== 'string' || !/<rss[\s>]/.test(xml)) return null;
  const numbers = [];
  for (const match of xml.matchAll(/biblionumber=(\d+)/g)) {
    if (!numbers.includes(match[1])) numbers.push(match[1]);
  }
  return numbers;
}

function fieldsOf(record, tag) {
  return (record?.fields || [])
    .filter((f) => Object.prototype.hasOwnProperty.call(f, tag))
    .map((f) => f[tag]);
}

function subfield(field, code) {
  const hit = (field?.subfields || []).find((s) => Object.prototype.hasOwnProperty.call(s, code));
  return hit ? hit[code] : null;
}

/** "Θεσσαλονίκη :" → "Θεσσαλονίκη", "Κουρσάλ," → "Κουρσάλ" (ISBD punctuation). */
function clean(text) {
  if (text === null || text === undefined) return null;
  // A loop, not /[\s:;,./=]+$/: that regex is quadratic on a long run of punctuation inside the text
  const s = String(text);
  let end = s.length;
  while (end > 0 && (':;,./='.includes(s[end - 1]) || /\s/u.test(s[end - 1]))) end--;
  const trimmed = s.slice(0, end).trim();
  return trimmed || null;
}

function mapBiblio(record, biblionumber) {
  const f245 = fieldsOf(record, '245')[0];
  const f260 = fieldsOf(record, '260')[0] || fieldsOf(record, '264')[0];
  const main = clean(subfield(f245, 'a'));
  const rest = clean(subfield(f245, 'b'));
  return {
    isSerial: typeof record?.leader === 'string' && record.leader[7] === 's',
    issn: normalizeIssn(subfield(fieldsOf(record, '022')[0], 'a')),
    // print and online editions may both be listed; any of them identifies the record
    issns: fieldsOf(record, '022').map((f) => normalizeIssn(subfield(f, 'a'))).filter(Boolean),
    title: main && rest ? `${main} : ${rest}` : main,
    place: clean(subfield(f260, 'a')),
    publisherName: clean(subfield(f260, 'b')),
    periodicity: clean(subfield(fieldsOf(record, '310')[0], 'a')),
    nlgBiblionumber: String(biblionumber),
  };
}

module.exports = { biblionumbersFromRss, mapBiblio };
