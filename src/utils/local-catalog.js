'use strict';

const { DuplicateRecordError } = require('./catalog-lifecycle');
const { getUserLibraryId } = require('./library');
const { isUniqueViolation } = require('./db-errors');

const LOCAL_FIELDS = {
  person: ['name', 'qualifier', 'firstname', 'middlename', 'lastname', 'bornYear', 'deathYear', 'biography'],
  publisher: ['name', 'qualifier', 'alternativeName', 'address', 'phone', 'email', 'website'],
  book: ['title', 'subtitle', 'yearPublished', 'pages', 'language', 'originalLanguage', 'edition', 'place', 'series', 'summary'],
  magazine: ['title', 'qualifier', 'issn', 'place', 'periodicity'],
  issue: ['issueNumber', 'publicationMonthYear'],
};

const INTEGER_FIELDS = new Set(['yearPublished', 'pages']);

class LocalInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LocalInputError';
  }
}

function pickFields(input, fields) {
  const out = {};
  for (const field of fields) {
    let value = input[field];
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') value = value.trim();
    if (value === '') continue;
    if (INTEGER_FIELDS.has(field)) {
      const n = Number(value);
      if (!Number.isInteger(n)) throw new LocalInputError(`Το πεδίο ${field} πρέπει να είναι ακέραιος αριθμός.`);
      value = n;
    }
    out[field] = value;
  }
  return out;
}

async function assertRelationsExist(uid, ids, label) {
  if (!ids.length) return;
  if (!ids.every((id) => Number.isInteger(id))) throw new LocalInputError(`Μη έγκυρο id για ${label}.`);
  const unique = [...new Set(ids)];
  const found = await strapi.db.query(uid).count({ where: { id: { $in: unique } } });
  if (found !== unique.length) throw new LocalInputError(`Δεν βρέθηκε ${label}.`);
}

async function respond(controller, ctx, entity) {
  return controller.transformResponse(await controller.sanitizeOutput(entity, ctx)).data;
}

/**
 * findConflict: optional; on a unique-index violation (a parallel request stored the same identifier)
 * it returns the record that won, which is answered as a 409 candidate instead of a 400.
 */
async function createLocalRecord(ctx, controller, uid, data, populate = {}, { findConflict } = {}) {
  const libraryId = await getUserLibraryId(strapi, ctx.state.user);
  if (!libraryId) return ctx.forbidden('Ο χρήστης δεν ανήκει σε βιβλιοθήκη.');

  try {
    const created = await strapi.entityService.create(uid, {
      data: { ...data, catalogedBy: libraryId, reviewed: false },
      populate,
    });
    ctx.status = 201;
    ctx.body = { source: 'local', data: await respond(controller, ctx, created) };
  } catch (err) {
    if (err instanceof DuplicateRecordError) {
      const ids = err.details.candidates.map((c) => c.id);
      const candidates = await strapi.entityService.findMany(uid, { filters: { id: { $in: ids } }, populate });
      ctx.status = 409;
      ctx.body = {
        data: null,
        error: { status: 409, name: 'DuplicateRecordError', message: err.message },
        candidates: await respond(controller, ctx, candidates),
      };
      return;
    }
    if (findConflict && isUniqueViolation(err)) {
      const winner = await findConflict();
      if (winner) {
        ctx.status = 409;
        ctx.body = {
          data: null,
          error: { status: 409, name: 'DuplicateRecordError', message: 'Η εγγραφή υπάρχει ήδη στον κατάλογο.' },
          candidates: [await respond(controller, ctx, winner)],
        };
        return;
      }
    }
    if (err.name === 'ApplicationError' || err.name === 'ValidationError') return ctx.badRequest(err.message);
    throw err;
  }
}

module.exports = { LOCAL_FIELDS, LocalInputError, pickFields, assertRelationsExist, createLocalRecord };
