'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/books/search-biblionet',
      handler: 'book.searchBiblionet',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
