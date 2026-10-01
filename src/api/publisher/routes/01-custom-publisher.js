'use strict';

module.exports = {
  routes: [
    { method: 'GET', path: '/publishers/search', handler: 'publisher.search' },
    { method: 'GET', path: '/publishers/in-library', handler: 'publisher.inLibrary' },
    { method: 'POST', path: '/publishers/local', handler: 'publisher.createLocal' },
  ],
};
