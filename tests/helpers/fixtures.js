'use strict';

/**
 * Contract fixtures: real Strapi responses written to the JavaFX test resources.
 * documentId changes on every run, so it becomes "<type>-<id>"; the type comes from the relation key,
 * so a library, a copy and a person never share a value.
 */

const fs = require('fs');
const path = require('path');

const FIXTURE_DIR = path.join(
  __dirname, '..', '..', '..',
  'LibraryManagementSystemDesktopApp', 'src', 'test', 'resources', 'strapi-fixtures'
);
const VOLATILE = new Set(['createdAt', 'updatedAt', 'publishedAt', 'quota']);
const TYPE_BY_KEY = {
  publisher: 'publisher', subjects: 'subject', copies: 'copy', library: 'library', person: 'person',
  role: 'role', magazine: 'magazine', publication: 'book', issues: 'book',
};

function stripVolatile(value, type) {
  if (Array.isArray(value)) return value.map((v) => stripVolatile(v, type));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (VOLATILE.has(k)) continue;
      if (k === 'documentId' && value.id !== undefined) out[k] = `${type}-${value.id}`;
      else out[k] = stripVolatile(v, TYPE_BY_KEY[k] || type);
    }
    return out;
  }
  return value;
}

function writeFixture(name, body, type) {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  fs.writeFileSync(path.join(FIXTURE_DIR, name), `${JSON.stringify(stripVolatile(body, type), null, 2)}\n`);
}

module.exports = { stripVolatile, writeFixture, FIXTURE_DIR };
