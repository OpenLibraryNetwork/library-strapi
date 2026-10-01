'use strict';

const { errors } = require('@strapi/utils');
const { applyCatalogKeys, assertNotReferenced, assertNoInverseRelationChange } = require('../../../../utils/catalog-lifecycle');
const { validateMerge, executeMerge } = require('../../../../utils/merge');
const { extractRelationId } = require('../../../../utils/relation-id');

/**
 * Book (Έντυπα) lifecycle hooks
 * Enforces field constraints based on publication type.
 *
 * Rules:
 * - Βιβλίο:    isbn REQUIRED, biblionetId optional, issueNumber/magazine FORBIDDEN
 * - Μπροσούρα: isbn/biblionetId FORBIDDEN, issueNumber/magazine FORBIDDEN
 * - Περιοδικό: isbn/biblionetId FORBIDDEN, magazine REQUIRED, issueNumber or publicationMonthYear REQUIRED
 */

function validateByType({ params: { data } }) {
  // Skip if type is not being set (partial update without type)
  if (!data || !data.type) return;

  const type = data.type;

  if (type === 'Βιβλίο') {
    if (!data.isbn) {
      throw new errors.ApplicationError('ISBN is required for books');
    }
    // Clear periodical-only fields
    data.issueNumber = null;
    data.publicationMonthYear = null;
    data.magazine = null;
  }

  if (type === 'Μπροσούρα') {
    // Clear all identifier and periodical fields
    data.isbn = null;
    data.biblionetId = null;
    data.biblionetCategoryId = null;
    data.issueNumber = null;
    data.publicationMonthYear = null;
    data.magazine = null;
  }
}

/**
 * Periodical issue: magazine required (also after an admin relation edit), number or period required
 * (values already stored count on a partial save), and the title is always the magazine's title.
 */
async function applyIssueRules(event) {
  const { data } = event.params;
  if (!data || data.type !== 'Περιοδικό') return;

  const id = event.params.where?.id;
  const existing = id && event.action.startsWith('beforeUpdate')
    ? await strapi.db.query('api::book.book').findOne({ where: { id }, populate: ['magazine'] })
    : null;
  const change = extractRelationId(data.magazine);
  const magazineId = change.changed ? change.id : existing?.magazine?.id ?? null;
  if (!magazineId) throw new errors.ApplicationError('Το τεύχος χρειάζεται περιοδικό.');
  const magazine = await strapi.db.query('api::magazine.magazine').findOne({ where: { id: magazineId }, select: ['id', 'title'] });
  if (!magazine) throw new errors.ApplicationError('Δεν βρέθηκε το περιοδικό του τεύχους.');

  const trim = (v) => (typeof v === 'string' ? v.trim() : v);
  const number = data.issueNumber !== undefined ? trim(data.issueNumber) : existing?.issueNumber;
  const period = data.publicationMonthYear !== undefined ? trim(data.publicationMonthYear) : existing?.publicationMonthYear;
  if (!number && !period) throw new errors.ApplicationError('Συμπληρώστε αριθμό ή περίοδο τεύχους.');
  if (data.issueNumber !== undefined) data.issueNumber = number || null;
  if (data.publicationMonthYear !== undefined) data.publicationMonthYear = period || null;

  data.title = magazine.title;
  // Clear book-only fields
  data.isbn = null;
  data.biblionetId = null;
  data.biblionetCategoryId = null;
}

module.exports = {
  async beforeCreate(event) {
    assertNoInverseRelationChange('book', event);
    validateByType(event);
    await applyIssueRules(event);
    await applyCatalogKeys('book', event);
  },
  async beforeUpdate(event) {
    assertNoInverseRelationChange('book', event);
    validateByType(event);
    await applyIssueRules(event);
    await validateMerge('book', event);
    await applyCatalogKeys('book', event);
  },
  async afterUpdate(event) { await executeMerge('book', event); },
  async beforeDelete(event) { await assertNotReferenced('book', event); },
  async beforeDeleteMany(event) { await assertNotReferenced('book', event); },
};
