'use strict';

const { applyCatalogKeys, assertNotReferenced, assertNoInverseRelationChange } = require('../../../../utils/catalog-lifecycle');
const { validateMerge, executeMerge } = require('../../../../utils/merge');

module.exports = {
  async beforeCreate(event) {
    assertNoInverseRelationChange('publisher', event);
    await applyCatalogKeys('publisher', event);
  },
  async beforeUpdate(event) {
    assertNoInverseRelationChange('publisher', event);
    await validateMerge('publisher', event);
    await applyCatalogKeys('publisher', event);
  },
  async afterUpdate(event) { await executeMerge('publisher', event); },
  async beforeDelete(event) { await assertNotReferenced('publisher', event); },
  async beforeDeleteMany(event) { await assertNotReferenced('publisher', event); },
};
