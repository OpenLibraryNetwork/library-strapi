'use strict';

const request = require('supertest');
const { setupStrapi, cleanupStrapi } = require('../helpers/strapi');
const { createLibrarian } = require('../helpers/auth');

let jwt;
let bookId;
let personId;
let publisherId;

beforeAll(async () => {
  await setupStrapi();
  ({ jwt } = await createLibrarian(strapi));
  bookId = (await strapi.entityService.create('api::book.book', { data: { title: 'Δ', type: 'Μπροσούρα' } })).id;
  personId = (await strapi.entityService.create('api::person.person', { data: { name: 'Δοκιμή Πρόσωπο' } })).id;
  publisherId = (await strapi.entityService.create('api::publisher.publisher', { data: { name: 'Δοκιμή Εκδότης' } })).id;
});
afterAll(async () => { await cleanupStrapi(); });

const http = () => request(strapi.server.httpServer);
const auth = (req) => req.set('Authorization', `Bearer ${jwt}`);

test('librarian can read the catalog', async () => {
  for (const path of ['/api/books', '/api/persons', '/api/publishers', '/api/subjects', '/api/contributor-roles', '/api/libraries']) {
    const res = await auth(http().get(path));
    expect([path, res.status]).toEqual([path, 200]);
  }
});

test.each([
  ['put', () => `/api/books/${bookId}`],
  ['delete', () => `/api/books/${bookId}`],
  ['post', () => '/api/books'],
  ['put', () => `/api/persons/${personId}`],
  ['delete', () => `/api/persons/${personId}`],
  ['post', () => '/api/persons'],
  ['put', () => `/api/publishers/${publisherId}`],
  ['delete', () => `/api/publishers/${publisherId}`],
  ['post', () => '/api/publishers'],
  ['post', () => '/api/subjects'],
  ['post', () => '/api/contributor-roles'],
  ['post', () => '/api/magazines'],
  ['put', () => '/api/magazines/1'],
  ['delete', () => '/api/magazines/1'],
])('librarian gets 403 on %s %s', async (method, path) => {
  const res = await auth(http()[method](path())).send({ data: { name: 'x', title: 'x' } });
  expect(res.status).toBe(403);
});

test('public can read persons but not write', async () => {
  expect((await http().get('/api/persons')).status).toBe(200);
  expect((await http().put(`/api/persons/${personId}`).send({ data: { name: 'x' } })).status).toBe(403);
});

test('sync removes stale api permissions and keeps plugin permissions', async () => {
  const { syncPermissions } = require('../../src/bootstrap/permissions');
  const role = await strapi.db.query('plugin::users-permissions.role').findOne({ where: { type: 'librarian' } });
  const perms = strapi.db.query('plugin::users-permissions.permission');
  await perms.create({ data: { action: 'api::book.book.update', role: role.id } });
  await perms.create({ data: { action: 'plugin::users-permissions.user.me', role: role.id } });

  await syncPermissions(strapi);

  const actions = (await perms.findMany({ where: { role: role.id } })).map((p) => p.action);
  expect(actions).not.toContain('api::book.book.update');
  expect(actions).toContain('plugin::users-permissions.user.me');
  expect(actions).toContain('api::copy.copy.borrowCopy');
});

test('a mistyped action is reported in the log, not silently dropped', async () => {
  const permissions = require('../../src/bootstrap/permissions');
  const warn = jest.spyOn(strapi.log, 'warn');
  permissions.LIBRARIAN_ACTIONS.push('api::book.book.serch');
  try {
    await permissions.syncPermissions(strapi);
  } finally {
    permissions.LIBRARIAN_ACTIONS.pop();
  }
  expect(warn.mock.calls.flat().join('\n')).toContain('api::book.book.serch');
  warn.mockRestore();
});
