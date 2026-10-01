'use strict';

module.exports = {
  routes: [
    { method: 'POST', path: '/magazines/issn-lookup', handler: 'magazine.issnLookup' },
    { method: 'POST', path: '/magazines/local', handler: 'magazine.createLocal' },
    { method: 'GET', path: '/magazines/search', handler: 'magazine.search' },
    { method: 'GET', path: '/magazines/in-library', handler: 'magazine.inLibrary' },
  ],
};
