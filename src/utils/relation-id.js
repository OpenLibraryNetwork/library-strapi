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

// A target given by numeric id or by documentId: the raw Document Service payload, before Strapi resolves it.
function refOf(item) {
  if (item === null || item === undefined) return null;
  if (typeof item === 'object') return item.id ?? item.documentId ?? null;
  return item === '' ? null : item;
}

function extract(value, pick) {
  if (value === undefined) return { changed: false, id: null };
  if (value === null) return { changed: true, id: null };
  if (Array.isArray(value)) return { changed: true, id: value.length ? pick(value[0]) : null };
  if (typeof value === 'object') {
    if (Array.isArray(value.set)) return { changed: true, id: value.set.length ? pick(value.set[0]) : null };
    if (Array.isArray(value.connect) || Array.isArray(value.disconnect)) {
      const connect = value.connect || [];
      const disconnect = value.disconnect || [];
      if (connect.length) return { changed: true, id: pick(connect[connect.length - 1]) };
      if (disconnect.length) return { changed: true, id: null };
      return { changed: false, id: null };
    }
    return { changed: true, id: pick(value) };
  }
  return { changed: true, id: pick(value) };
}

/** For database lifecycles, where Strapi has already resolved every target to its numeric id. */
function extractRelationId(value) {
  return extract(value, idOf);
}

/** For the raw Document Service payload: the target is a numeric id or a documentId (string or { documentId }). */
function extractRelationRef(value) {
  return extract(value, refOf);
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

module.exports = { extractRelationId, extractRelationRef, isToManyChange };
