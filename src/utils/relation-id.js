'use strict';

/**
 * Extracts the target id of a single relation from any payload shape Strapi accepts,
 * including the admin panel's { connect, disconnect } format.
 */

function idOf(item) {
  if (item === null || item === undefined) return null;
  if (typeof item === 'object') return item.id === undefined ? null : Number(item.id);
  const n = Number(item);
  return Number.isNaN(n) ? null : n;
}

function extractRelationId(value) {
  if (value === undefined) return { changed: false, id: null };
  if (value === null) return { changed: true, id: null };
  if (Array.isArray(value)) return { changed: true, id: value.length ? idOf(value[0]) : null };
  if (typeof value === 'object') {
    if (Array.isArray(value.set)) return { changed: true, id: value.set.length ? idOf(value.set[0]) : null };
    if (Array.isArray(value.connect) || Array.isArray(value.disconnect)) {
      const connect = value.connect || [];
      const disconnect = value.disconnect || [];
      if (connect.length) return { changed: true, id: idOf(connect[connect.length - 1]) };
      if (disconnect.length) return { changed: true, id: null };
      return { changed: false, id: null };
    }
    return { changed: true, id: idOf(value) };
  }
  return { changed: true, id: idOf(value) };
}

/**
 * True when a to-many relation payload would change the relation.
 * The admin panel sends { connect: [], disconnect: [] } on every save, which is not a change.
 */
function isToManyChange(value) {
  if (value === undefined) return false;
  if (value === null || Array.isArray(value)) return true;
  if (typeof value === 'object') {
    if (Array.isArray(value.set)) return true;
    return (value.connect || []).length > 0 || (value.disconnect || []).length > 0;
  }
  return true;
}

module.exports = { extractRelationId, isToManyChange };
