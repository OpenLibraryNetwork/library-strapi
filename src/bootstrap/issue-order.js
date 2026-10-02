'use strict';

const { issueOrderOf } = require('../utils/text-keys');

const BOOK = 'api::book.book';

/**
 * Issues catalogued before issueOrder existed get it once. Only that column is written (no lifecycles,
 * updatedAt unchanged); running again finds nothing to do. Returns how many issues were filled.
 */
async function backfillIssueOrder(strapi) {
  const missing = await strapi.db.query(BOOK).findMany({
    where: { type: 'Περιοδικό', issueOrder: null },
    select: ['id', 'issueNumber'],
  });
  const meta = strapi.db.metadata.get(BOOK);
  const column = meta.attributes.issueOrder.columnName;
  for (const issue of missing) {
    await strapi.db.connection(meta.tableName).where({ id: issue.id }).update({ [column]: issueOrderOf(issue.issueNumber) });
  }
  return missing.length;
}

module.exports = { backfillIssueOrder };
