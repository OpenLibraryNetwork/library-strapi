'use strict';

const { errors } = require('@strapi/utils');
const { extractRelationId } = require('./relation-id');
const { runAsMerge } = require('./merge-context');
const { DuplicateRecordError } = require('./catalog-lifecycle');

const UIDS = {
  person: 'api::person.person',
  publisher: 'api::publisher.publisher',
  book: 'api::book.book',
  magazine: 'api::magazine.magazine',
};
const BIBLIONET_FIELD = { person: 'biblionetPersonId', publisher: 'biblionetCompanyId', book: 'biblionetId', magazine: 'nlgBiblionumber' };

async function validateMerge(kind, event) {
  const change = extractRelationId(event.params.data.mergeInto);
  if (!change.changed || change.id === null) return;

  const uid = UIDS[kind];
  const sourceId = Number(event.params.where.id);
  if (change.id === sourceId) throw new errors.ApplicationError('Μια εγγραφή δεν μπορεί να συγχωνευθεί με τον εαυτό της.');

  const target = await strapi.entityService.findOne(uid, change.id, { populate: ['mergeInto'] });
  if (!target) throw new errors.ApplicationError('Δεν βρέθηκε η εγγραφή-στόχος της συγχώνευσης.');
  if (target.mergeInto) throw new errors.ApplicationError('Η εγγραφή-στόχος συγχωνεύεται ήδη σε άλλη εγγραφή.');

  const source = await strapi.entityService.findOne(uid, sourceId);
  const field = BIBLIONET_FIELD[kind];
  if (kind === 'book') {
    if (source[field]) throw new errors.ApplicationError('Έντυπα της Biblionet δεν συγχωνεύονται.');
    if (source.type !== target.type) throw new errors.ApplicationError('Συγχώνευση επιτρέπεται μόνο μεταξύ εντύπων του ίδιου τύπου.');
  } else if (source[field] && target[field]) {
    const origin = kind === 'magazine' ? 'την Εθνική Βιβλιοθήκη' : 'τη Biblionet';
    throw new errors.ApplicationError(`Και οι δύο εγγραφές προέρχονται από ${origin} και θεωρούνται διαφορετικές. Η συγχώνευση απορρίφθηκε.`);
  }

  event.state = { ...(event.state || {}), mergeTargetId: change.id };
}

async function mergePerson(sourceId, targetId) {
  const books = await strapi.entityService.findMany(UIDS.book, {
    filters: { contributors: { person: { id: sourceId } } },
    populate: { contributors: { populate: ['person', 'role'] } },
  });
  for (const book of books) {
    const seen = new Set();
    const contributors = [];
    for (const c of book.contributors) {
      const person = c.person?.id === sourceId ? targetId : c.person?.id;
      const role = c.role?.id;
      const key = `${person}|${role}`;
      if (seen.has(key)) continue;
      seen.add(key);
      contributors.push({ person, role });
    }
    await strapi.entityService.update(UIDS.book, book.id, { data: { contributors } });
  }
}

async function mergePublisher(sourceId, targetId) {
  for (const uid of [UIDS.book, 'api::magazine.magazine']) {
    const rows = await strapi.entityService.findMany(uid, { filters: { publisher: { id: sourceId } }, fields: ['id', 'title'] });
    for (const row of rows) {
      try {
        await strapi.entityService.update(uid, row.id, { data: { publisher: targetId } });
      } catch (err) {
        if (!(err instanceof DuplicateRecordError)) throw err;
        const other = err.details.candidates.map((c) => c.id).join(', ');
        throw new errors.ApplicationError(
          `Η συγχώνευση θα έκανε τη μπροσούρα «${row.title}» (id: ${row.id}) ίδια με τη μπροσούρα id: ${other}. ` +
            'Συγχωνεύστε πρώτα τις μπροσούρες και μετά τους εκδότες.'
        );
      }
    }
  }
}

async function mergeBook(sourceId, targetId) {
  const COPY = 'api::copy.copy';
  const targetCopies = await strapi.entityService.findMany(COPY, { filters: { publication: { id: targetId } }, populate: ['library'] });
  const used = new Map(); // libraryId -> Set(copyNumber)
  for (const c of targetCopies) {
    const lib = c.library?.id ?? null;
    if (!used.has(lib)) used.set(lib, new Set());
    used.get(lib).add(c.copyNumber);
  }
  const sourceCopies = await strapi.entityService.findMany(COPY, {
    filters: { publication: { id: sourceId } },
    populate: ['library'],
    sort: 'copyNumber',
  });
  for (const c of sourceCopies) {
    const lib = c.library?.id ?? null;
    if (!used.has(lib)) used.set(lib, new Set());
    const numbers = used.get(lib);
    let copyNumber = c.copyNumber;
    if (numbers.has(copyNumber)) copyNumber = Math.max(...numbers) + 1;
    numbers.add(copyNumber);
    await strapi.entityService.update(COPY, c.id, { data: { publication: targetId, copyNumber } });
  }
}

async function mergeMagazine(sourceId, targetId) {
  const target = await strapi.entityService.findOne(UIDS.magazine, targetId);
  const issues = await strapi.entityService.findMany(UIDS.book, {
    filters: { magazine: { id: sourceId } },
    fields: ['id', 'issueNumber', 'publicationMonthYear'],
  });
  for (const issue of issues) {
    try {
      await strapi.entityService.update(UIDS.book, issue.id, { data: { magazine: targetId, title: target.title } });
    } catch (err) {
      if (!(err instanceof DuplicateRecordError)) throw err;
      const other = err.details.candidates.map((c) => c.id).join(', ');
      const label = issue.issueNumber ? `τεύχος ${issue.issueNumber}` : issue.publicationMonthYear;
      throw new errors.ApplicationError(
        `Η συγχώνευση θα έκανε το «${label}» (id: ${issue.id}) ίδιο με το τεύχος id: ${other} του περιοδικού-στόχου. ` +
          'Συγχωνεύστε πρώτα τα τεύχη και μετά τα περιοδικά.'
      );
    }
  }
}

const MERGERS = { person: mergePerson, publisher: mergePublisher, book: mergeBook, magazine: mergeMagazine };

async function executeMerge(kind, event) {
  const targetId = event.state?.mergeTargetId;
  if (!targetId) return;
  const uid = UIDS[kind];
  const sourceId = event.result.id;
  const field = BIBLIONET_FIELD[kind];

  // Runs inside the update's transaction (see bootstrap/entity-service.js): on any error the whole
  // update, including the mergeInto value, is rolled back and the original error reaches the admin.
  await runAsMerge(() => strapi.db.transaction(async () => {
    const source = await strapi.entityService.findOne(uid, sourceId);
    await MERGERS[kind](sourceId, targetId);
    await strapi.entityService.delete(uid, sourceId);
    if (kind !== 'book' && source[field]) {
      const target = await strapi.entityService.findOne(uid, targetId);
      if (!target[field]) await strapi.entityService.update(uid, targetId, { data: { [field]: source[field] } });
    }
  }));
}

module.exports = { validateMerge, executeMerge };
