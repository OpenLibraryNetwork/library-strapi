'use strict';

/**
 * Magazine (Περιοδικά) lifecycle hooks: catalog keys and duplicates, merge, delete protection.
 * Issues are attached only from the issue (book) side; a title change is copied to the issues,
 * whose title is always the magazine's title.
 */

const { applyCatalogKeys, assertNotReferenced, assertNoInverseRelationChange } = require('../../../../utils/catalog-lifecycle');
const { validateMerge, executeMerge } = require('../../../../utils/merge');
const { isMerging } = require('../../../../utils/merge-context');

async function syncIssueTitles(event) {
  if (event.params.data?.title === undefined || isMerging() || event.state?.mergeTargetId) return;
  const magazine = event.result;
  const issues = await strapi.entityService.findMany('api::book.book', {
    filters: { magazine: { id: magazine.id }, title: { $ne: magazine.title } },
    fields: ['id'],
  });
  for (const issue of issues) {
    await strapi.entityService.update('api::book.book', issue.id, { data: { title: magazine.title } });
  }
}

module.exports = {
  async beforeCreate(event) {
    assertNoInverseRelationChange('magazine', event);
    await applyCatalogKeys('magazine', event);
  },
  async beforeUpdate(event) {
    assertNoInverseRelationChange('magazine', event);
    await validateMerge('magazine', event);
    await applyCatalogKeys('magazine', event);
  },
  async afterUpdate(event) {
    await executeMerge('magazine', event);
    await syncIssueTitles(event);
  },
  async beforeDelete(event) { await assertNotReferenced('magazine', event); },
  async beforeDeleteMany(event) { await assertNotReferenced('magazine', event); },
};
