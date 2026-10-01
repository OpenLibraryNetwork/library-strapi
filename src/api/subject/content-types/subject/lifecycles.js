'use strict';

const { assertNotReferenced } = require('../../../../utils/catalog-lifecycle');

module.exports = {
  async beforeDelete(event) { await assertNotReferenced('subject', event); },
  async beforeDeleteMany(event) { await assertNotReferenced('subject', event); },
};
