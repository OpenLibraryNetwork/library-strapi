'use strict';

const { applyCatalogKeys, assertNotReferenced } = require('../../../../utils/catalog-lifecycle');
const { validateMerge, executeMerge } = require('../../../../utils/merge');

module.exports = {
  async beforeCreate(event) { await applyCatalogKeys('person', event); },
  async beforeUpdate(event) {
    await validateMerge('person', event);
    await applyCatalogKeys('person', event);
  },
  async afterUpdate(event) { await executeMerge('person', event); },
  async beforeDelete(event) { await assertNotReferenced('person', event); },
  async beforeDeleteMany(event) { await assertNotReferenced('person', event); },
};
