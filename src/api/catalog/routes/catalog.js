'use strict';

// Public catalogue for the website (frontend token): lean, paginated, filtered in Strapi.
module.exports = {
  type: 'content-api',
  routes: [
    { method: 'GET', path: '/catalog/publications', handler: 'catalog.publications' },
    { method: 'GET', path: '/catalog/search-counts', handler: 'catalog.searchCounts' },
    { method: 'GET', path: '/catalog/persons', handler: 'catalog.persons' },
    { method: 'GET', path: '/catalog/publishers', handler: 'catalog.publishers' },
    { method: 'GET', path: '/catalog/magazines', handler: 'catalog.magazines' },
    { method: 'GET', path: '/catalog/libraries', handler: 'catalog.libraries' },
  ],
};
