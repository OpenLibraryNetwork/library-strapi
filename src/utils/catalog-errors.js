'use strict';

class InvalidIsbnError extends Error {
  constructor(raw) {
    super(`Μη έγκυρο ISBN: ${raw ?? ''}`);
    this.name = 'InvalidIsbnError';
  }
}

class QuotaExceededError extends Error {
  constructor(limit) {
    super(`Ημερήσιο όριο Biblionet API (${limit} κλήσεις). Δοκιμάστε αύριο.`);
    this.name = 'QuotaExceededError';
  }
}

class BiblionetUnavailableError extends Error {
  constructor(cause) {
    super(`Η Biblionet δεν απάντησε σωστά (${cause}). Δοκιμάστε ξανά αργότερα.`);
    this.name = 'BiblionetUnavailableError';
  }
}

class NlgUnavailableError extends Error {
  constructor(cause) {
    super(`Η Εθνική Βιβλιοθήκη δεν απάντησε σωστά (${cause}).`);
    this.name = 'NlgUnavailableError';
  }
}

module.exports = { InvalidIsbnError, QuotaExceededError, BiblionetUnavailableError, NlgUnavailableError };
