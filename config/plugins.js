'use strict';

module.exports = ({ env }) => ({
  'users-permissions': {
    config: {
      jwt: {
        expiresIn: '90d', // 90-day JWT lifetime
      },
    },
  },
});
