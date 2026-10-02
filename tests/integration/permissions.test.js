'use strict';

const docs = require('../helpers/docs');
const request = require('supertest');
const { setupStrapi, cleanupStrapi } = require('../helpers/strapi');
const { createLibrarian } = require('../helpers/auth');
const { frontendTokenKey } = require('../helpers/api-token');

let jwt;
let bookId;
let personId;
let publisherId;

beforeAll(async () => {
  await setupStrapi();
  ({ jwt } = await createLibrarian(strapi));
  bookId = (await docs.create('api::book.book', { data: { title: 'Δ', type: 'Μπροσούρα' } })).id;
  personId = (await docs.create('api::person.person', { data: { name: 'Δοκιμή Πρόσωπο' } })).id;
  publisherId = (await docs.create('api::publisher.publisher', { data: { name: 'Δοκιμή Εκδότης' } })).id;
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

const READ_PATHS = [
  '/api/books',
  '/api/persons',
  '/api/publishers',
  '/api/subjects',
  '/api/contributor-roles',
  '/api/libraries',
  '/api/copies',
  '/api/magazines',
  '/api/catalog/publications',
  `/api/catalog/search-counts?q=${encodeURIComponent('δοκιμη')}`,
  `/api/catalog/persons?q=${encodeURIComponent('δοκιμη')}`,
  `/api/catalog/publishers?q=${encodeURIComponent('δοκιμη')}`,
  `/api/catalog/magazines?q=${encodeURIComponent('δοκιμη')}`,
  '/api/catalog/libraries',
];

// The search endpoints belong to the JavaFX librarians: the site uses /api/catalog.
const JAVAFX_SEARCH_PATHS = ['books', 'persons', 'publishers', 'magazines']
  .map((c) => `/api/${c}/search?q=${encodeURIComponent('δοκιμη')}`);

test.each([...READ_PATHS, ...JAVAFX_SEARCH_PATHS])('public gets 403 on GET %s', async (path) => {
  expect((await http().get(path)).status).toBe(403);
});

test('public can still log in', async () => {
  const { user } = await createLibrarian(strapi, { libraryName: 'Σύνδεση' });
  const res = await http().post('/api/auth/local').send({ identifier: user.email, password: 'Test1234!' });
  expect(res.status).toBe(200);
  expect(res.body.jwt).toBeTruthy();
});

describe('frontend token', () => {
  let key;
  beforeAll(async () => { key = await frontendTokenKey(strapi); });
  const asFrontend = (req) => req.set('Authorization', `Bearer ${key}`);

  test.each(READ_PATHS)('reads GET %s', async (path) => {
    expect((await asFrontend(http().get(path))).status).toBe(200);
  });

  test.each(JAVAFX_SEARCH_PATHS)('gets 403 on the JavaFX search GET %s', async (path) => {
    expect((await asFrontend(http().get(path))).status).toBe(403);
  });

  test('the removed browse endpoint is gone', async () => {
    expect((await asFrontend(http().get('/api/books/browse'))).status).toBe(404);
  });

  test.each([
    ['post', () => '/api/books'],
    ['put', () => `/api/persons/${personId}`],
    ['delete', () => `/api/publishers/${publisherId}`],
    ['post', () => '/api/copies'],
    ['post', () => '/api/copies/borrow'],
    ['post', () => '/api/books/local'],
    ['post', () => '/api/books/isbn-lookup'],
  ])('gets 403 on %s %s', async (method, path) => {
    const res = await asFrontend(http()[method](path())).send({ data: { name: 'x', title: 'x' } });
    expect(res.status).toBe(403);
  });
});

test('ensureApiTokens restores the permissions of an existing token and keeps its key', async () => {
  const { ensureApiTokens, FRONTEND_ACTIONS } = require('../../src/bootstrap/permissions');
  const service = strapi.service('admin::api-token');
  const key = await frontendTokenKey(strapi);
  const token = await service.getByName('frontend');
  await service.update(token.id, { permissions: ['api::book.book.find'] });

  await ensureApiTokens(strapi);

  const after = await service.getByName('frontend');
  expect([...after.permissions].sort()).toEqual([...FRONTEND_ACTIONS].sort());
  const res = await http().get('/api/catalog/publications').set('Authorization', `Bearer ${key}`);
  expect(res.status).toBe(200);
});

test('ensureApiTokens leaves tokens it does not define alone', async () => {
  const { ensureApiTokens } = require('../../src/bootstrap/permissions');
  const service = strapi.service('admin::api-token');
  await service.create({ name: 'χειροκίνητο', lifespan: null, type: 'custom', permissions: ['api::book.book.find'] });

  await ensureApiTokens(strapi);

  expect((await service.getByName('χειροκίνητο')).permissions).toEqual(['api::book.book.find']);
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

describe('unused anonymous auth endpoints are closed', () => {
  test.each([
    ['/api/auth/forgot-password', { email: 'someone@example.org' }],
    ['/api/auth/reset-password', { code: 'x', password: 'Test1234!', passwordConfirmation: 'Test1234!' }],
    ['/api/auth/send-email-confirmation', { email: 'someone@example.org' }],
  ])('public gets 403 on POST %s', async (path, body) => {
    expect((await http().post(path).send(body)).status).toBe(403);
  });

  test('public gets 403 on the social-login connect endpoint', async () => {
    expect((await http().get('/api/connect/github')).status).toBe(403);
  });

  test('the sync removes them again after someone enables them in the admin panel', async () => {
    const { syncPermissions } = require('../../src/bootstrap/permissions');
    const publicRole = await strapi.db.query('plugin::users-permissions.role').findOne({ where: { type: 'public' } });
    const perms = strapi.db.query('plugin::users-permissions.permission');
    await perms.create({ data: { action: 'plugin::users-permissions.auth.forgotPassword', role: publicRole.id } });

    await syncPermissions(strapi);

    const actions = (await perms.findMany({ where: { role: publicRole.id } })).map((p) => p.action);
    expect(actions).not.toContain('plugin::users-permissions.auth.forgotPassword');
    expect(actions).toContain('plugin::users-permissions.auth.callback'); // login stays
  });
});

test('repeated wrong logins from one address are cut off with 429 (login rate limit)', async () => {
  // Strapi keys /auth/local by path and IP only (not by account), so the logins of earlier tests count too:
  // within 11 attempts the limit of 10 per minute must have answered 429, and only 429 after that.
  const statuses = [];
  for (let i = 0; i < 11; i++) {
    statuses.push((await http().post('/api/auth/local').send({ identifier: `nobody-${i}@example.org`, password: 'wrong' })).status);
  }
  const first = statuses.indexOf(429);
  expect(first).toBeGreaterThan(0);
  expect(statuses.slice(0, first).every((s) => s === 400)).toBe(true);
  expect(statuses.slice(first).every((s) => s === 429)).toBe(true);
});
