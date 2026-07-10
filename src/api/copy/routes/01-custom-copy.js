'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/copies/borrow',
      handler: 'copy.borrowCopy',
      config: {
        policies: ['global::is-library-owner'],
      },
    },
    {
      method: 'POST',
      path: '/copies/return',
      handler: 'copy.returnCopy',
      config: {
        policies: ['global::is-library-owner'],
      },
    },
  ],
};
