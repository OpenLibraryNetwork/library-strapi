'use strict';

// Populate used by every book response.
const BOOK_POPULATE = {
  contributors: { populate: ['person', 'role'] },
  publisher: true,
  subjects: true,
  copies: { populate: ['library'] },
};

module.exports = { BOOK_POPULATE };
