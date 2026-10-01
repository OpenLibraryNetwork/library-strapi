'use strict';

const { errors } = require('@strapi/utils');
const { buildSearchKey, buildMatchKey } = require('./text-keys');
const { normalizeIsbn } = require('./isbn');
const { normalizeIssn } = require('./issn');
const { extractRelationId, extractRelationRef, isToManyChange } = require('./relation-id');
const { isMerging } = require('./merge-context');

const CATALOG_UIDS = {
  book: 'api::book.book',
  person: 'api::person.person',
  publisher: 'api::publisher.publisher',
  magazine: 'api::magazine.magazine',
};

class DuplicateRecordError extends errors.ApplicationError {
  constructor(candidates) {
    const ids = candidates.map((c) => c.id).join(', ');
    super(`Υπάρχει ήδη εγγραφή με τα ίδια στοιχεία (id: ${ids}).`, {
      candidates: candidates.map((c) => ({ id: c.id })),
    });
    this.name = 'DuplicateRecordError';
  }
}

function pick(data, existing, field) {
  return data[field] !== undefined ? data[field] : existing?.[field] ?? null;
}

async function loadExisting(uid, event) {
  const id = event.params.where?.id;
  if (!id || !event.action.startsWith('beforeUpdate')) return null;
  return strapi.db.query(uid).findOne({
    where: { id },
    populate: uid === CATALOG_UIDS.book ? ['publisher', 'magazine'] : [],
  });
}

// Only a change of the key can create a new duplicate. Merges are exempt: the source record is
// about to disappear, and a pre-existing collision (e.g. a Biblionet homonym imported later)
// must not lock the local record against edits or against being merged away.
function needsDuplicateCheck(event, existing, matchKey) {
  if (event.state?.mergeTargetId) return false;
  if (existing && existing.matchKey === matchKey) return false;
  return true;
}

async function assertNoDuplicate(uid, matchKey, excludeId, extraWhere = {}) {
  const where = { matchKey, ...extraWhere };
  if (excludeId) where.id = { $ne: excludeId };
  const found = await strapi.db.query(uid).findMany({ where, select: ['id'], limit: 5 });
  if (found.length) throw new DuplicateRecordError(found);
}

async function applyCatalogKeys(kind, event) {
  const uid = CATALOG_UIDS[kind];
  const data = event.params.data;
  const existing = await loadExisting(uid, event);
  const excludeId = event.params.where?.id;

  delete data.searchKey;
  delete data.matchKey;
  // A merge only happens on update; on create the field would just block later merges into this record.
  if (!event.action.startsWith('beforeUpdate')) delete data.mergeInto;

  if (kind === 'person' || kind === 'publisher') {
    const name = pick(data, existing, 'name');
    const qualifier = pick(data, existing, 'qualifier');
    data.searchKey = buildSearchKey(name, qualifier);
    data.matchKey = buildMatchKey(kind, { name, qualifier });
    const biblionetField = kind === 'person' ? 'biblionetPersonId' : 'biblionetCompanyId';
    if (!pick(data, existing, biblionetField) && needsDuplicateCheck(event, existing, data.matchKey)) {
      await assertNoDuplicate(uid, data.matchKey, excludeId);
    }
    return;
  }

  if (kind === 'magazine') {
    if (data.issn !== undefined && data.issn !== null && data.issn !== '') {
      const issn = normalizeIssn(data.issn);
      if (!issn) throw new errors.ApplicationError(`Μη έγκυρο ISSN: ${data.issn}`);
      data.issn = issn;
    }
    const title = pick(data, existing, 'title');
    const qualifier = pick(data, existing, 'qualifier');
    data.searchKey = buildSearchKey(title, qualifier, pick(data, existing, 'issn'));
    data.matchKey = buildMatchKey('magazine', { title, qualifier });
    if (!pick(data, existing, 'nlgBiblionumber') && needsDuplicateCheck(event, existing, data.matchKey)) {
      await assertNoDuplicate(uid, data.matchKey, excludeId);
    }
    return;
  }

  // book
  if (data.isbn !== undefined && data.isbn !== null && data.isbn !== '') {
    const isbn = normalizeIsbn(data.isbn);
    if (!isbn) throw new errors.ApplicationError(`Μη έγκυρο ISBN: ${data.isbn}`);
    data.isbn = isbn;
  }

  const title = pick(data, existing, 'title');
  const subtitle = pick(data, existing, 'subtitle');
  const type = pick(data, existing, 'type');
  data.searchKey = buildSearchKey(title, subtitle);

  if (type === 'Περιοδικό') {
    const magazineChange = extractRelationId(data.magazine);
    const magazineId = magazineChange.changed ? magazineChange.id : existing?.magazine?.id ?? null;
    data.matchKey = buildMatchKey('issue', {
      magazineId,
      issueNumber: pick(data, existing, 'issueNumber'),
      period: pick(data, existing, 'publicationMonthYear'),
    });
    if (needsDuplicateCheck(event, existing, data.matchKey)) {
      await assertNoDuplicate(uid, data.matchKey, excludeId, { type: 'Περιοδικό' });
    }
    return;
  }

  if (type !== 'Μπροσούρα') {
    data.matchKey = null;
    return;
  }

  const publisherChange = extractRelationId(data.publisher);
  const publisherId = publisherChange.changed ? publisherChange.id : existing?.publisher?.id ?? null;
  data.matchKey = buildMatchKey('brochure', {
    title,
    publisherId,
    yearPublished: pick(data, existing, 'yearPublished'),
  });
  if (needsDuplicateCheck(event, existing, data.matchKey)) {
    await assertNoDuplicate(uid, data.matchKey, excludeId, { type: 'Μπροσούρα' });
  }
}

// Runs on the raw Document Service payload (see bootstrap/catalog-middleware.js): targets may be documentIds.
function assertContributorsComplete(contributors) {
  if (!Array.isArray(contributors)) return;
  for (const entry of contributors) {
    const person = extractRelationRef(entry.person);
    const role = extractRelationRef(entry.role);
    const isNew = entry.id === undefined;
    const missing = isNew
      ? person.id === null || role.id === null
      : (person.changed && person.id === null) || (role.changed && role.id === null);
    if (missing) {
      throw new errors.ApplicationError('Κάθε συντελεστής χρειάζεται πρόσωπο και ρόλο.');
    }
  }
}

const REFERENCE_CHECKS = {
  person: (ids) => [
    ['api::book.book', { contributors: { person: { id: { $in: ids } } } }],
  ],
  publisher: (ids) => [
    ['api::book.book', { publisher: { id: { $in: ids } } }],
    ['api::magazine.magazine', { publisher: { id: { $in: ids } } }],
  ],
  role: (ids) => [
    ['api::book.book', { contributors: { role: { id: { $in: ids } } } }],
  ],
  subject: (ids) => [
    ['api::book.book', { subjects: { id: { $in: ids } } }],
  ],
  book: (ids) => [
    ['api::copy.copy', { publication: { id: { $in: ids } } }],
  ],
  magazine: (ids) => [['api::book.book', { magazine: { id: { $in: ids } } }]],
};

const OWN_UIDS = {
  person: 'api::person.person',
  publisher: 'api::publisher.publisher',
  role: 'api::contributor-role.contributor-role',
  subject: 'api::subject.subject',
  book: 'api::book.book',
  magazine: 'api::magazine.magazine',
};

async function idsOf(kind, event) {
  const where = event.params.where || {};
  if (typeof where.id === 'number' || typeof where.id === 'string') return [Number(where.id)];
  const rows = await strapi.db.query(OWN_UIDS[kind]).findMany({ where, select: ['id'] });
  return rows.map((r) => r.id);
}

async function assertNotReferenced(kind, event) {
  const ids = await idsOf(kind, event);
  if (!ids.length) return;
  for (const [uid, filters] of REFERENCE_CHECKS[kind](ids)) {
    const count = await strapi.documents(uid).count({ filters });
    if (count > 0) {
      const MESSAGES = {
        book: 'Το έντυπο έχει αντίτυπα και δεν μπορεί να διαγραφεί.',
        magazine: 'Το περιοδικό έχει τεύχη και δεν μπορεί να διαγραφεί. Χρησιμοποιήστε συγχώνευση (mergeInto).',
      };
      const message = MESSAGES[kind]
        ?? 'Η εγγραφή χρησιμοποιείται και δεν μπορεί να διαγραφεί. Χρησιμοποιήστε συγχώνευση (mergeInto).';
      throw new errors.ApplicationError(message);
    }
  }
}

/**
 * Inverse sides of relations (publisher.books, book.copies) bypass the owning record's
 * lifecycle, so its keys and rules would not run. They are changed only from the owning side.
 */
function assertNoInverseRelationChange(kind, event) {
  const data = event.params.data || {};
  if (kind === 'publisher' && isToManyChange(data.books)) {
    throw new errors.ApplicationError('Ο εκδότης ενός εντύπου αλλάζει από την εγγραφή του εντύπου.');
  }
  if (kind === 'book' && isToManyChange(data.copies) && !isMerging()) {
    throw new errors.ApplicationError('Τα αντίτυπα αλλάζουν μόνο από τη συλλογή «Αντίτυπα».');
  }
  if (kind === 'magazine' && isToManyChange(data.issues) && !isMerging()) {
    throw new errors.ApplicationError('Το περιοδικό ενός τεύχους αλλάζει από την εγγραφή του τεύχους.');
  }
}

module.exports = {
  CATALOG_UIDS,
  DuplicateRecordError,
  applyCatalogKeys,
  assertContributorsComplete,
  assertNotReferenced,
  assertNoInverseRelationChange,
};
