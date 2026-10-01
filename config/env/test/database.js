'use strict';

const path = require('path');

// One file per process: parallel jest runs (e.g. two sessions) must not share or delete each other's DB.
module.exports = () => ({
  connection: {
    client: 'sqlite',
    connection: {
      filename: path.join(__dirname, '..', '..', '..', '.tmp', `test-${process.pid}-${process.env.JEST_WORKER_ID || 0}.db`),
    },
    useNullAsDefault: true,
  },
});
