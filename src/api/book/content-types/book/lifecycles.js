'use strict';

/**
 * Book (Έντυπα) lifecycle hooks
 * Enforces field constraints based on publication type.
 *
 * Rules:
 * - Βιβλίο:    isbn REQUIRED, biblionetId optional, issueNumber/magazine FORBIDDEN
 * - Μπροσούρα: isbn/biblionetId FORBIDDEN, issueNumber/magazine FORBIDDEN
 * - Περιοδικό: isbn/biblionetId FORBIDDEN, issueNumber/magazine REQUIRED
 */

function validateByType({ params: { data } }) {
  // Skip if type is not being set (partial update without type)
  if (!data || !data.type) return;

  const type = data.type;

  if (type === 'Βιβλίο') {
    if (!data.isbn) {
      throw new strapi.errors.ValidationError('ISBN is required for books');
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

  if (type === 'Περιοδικό') {
    if (!data.issueNumber) {
      throw new strapi.errors.ValidationError('Issue number is required for periodicals');
    }
    if (!data.magazine) {
      throw new strapi.errors.ValidationError('Magazine is required for periodicals');
    }
    // Clear book-only fields
    data.isbn = null;
    data.biblionetId = null;
    data.biblionetCategoryId = null;
  }
}

module.exports = {
  beforeCreate(event) {
    validateByType(event);
  },
  beforeUpdate(event) {
    validateByType(event);
  },
};
