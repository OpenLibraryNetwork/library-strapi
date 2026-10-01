'use strict';

module.exports = {
  routes: [
    { method: 'GET', path: '/persons/search', handler: 'person.search' },
    { method: 'GET', path: '/persons/authors', handler: 'person.authors' },
    { method: 'POST', path: '/persons/local', handler: 'person.createLocal' },
  ],
};
