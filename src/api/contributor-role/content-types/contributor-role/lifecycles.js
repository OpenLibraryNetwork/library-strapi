'use strict';

const { assertNotReferenced } = require('../../../../utils/catalog-lifecycle');

module.exports = {
  async beforeDelete(event) { await assertNotReferenced('role', event); },
  async beforeDeleteMany(event) { await assertNotReferenced('role', event); },
};
