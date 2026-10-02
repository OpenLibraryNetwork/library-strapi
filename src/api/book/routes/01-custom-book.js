'use strict';

module.exports = {
  routes: [
    { method: 'GET', path: '/books/search', handler: 'book.search' },
    { method: 'POST', path: '/books/isbn-lookup', handler: 'book.isbnLookup' },
    { method: 'POST', path: '/books/local', handler: 'book.createLocal' },
  ],
};
