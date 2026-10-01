'use strict';

const request = require('supertest');
const docs = require('../helpers/docs');
const { setupStrapi, cleanupStrapi } = require('../helpers/strapi');
const { adminToken } = require('../helpers/admin');

let token;
beforeAll(async () => {
  await setupStrapi();
  token = await adminToken(strapi);
});
afterAll(async () => { await cleanupStrapi(); });

const cm = (method, path) =>
  request(strapi.server.httpServer)[method](`/content-manager/collection-types/${path}`).set('Authorization', `Bearer ${token}`);
const PERSON = 'api::person.person';
const MAG = 'api::magazine.magazine';
const BOOK = 'api::book.book';

test('admin: duplicate person is rejected (rules run for the cataloguer)', async () => {
  expect((await cm('post', PERSON).send({ name: 'Διαχείριση Πρόσωπο' })).status).toBe(201);
  const dup = await cm('post', PERSON).send({ name: 'ΔΙΑΧΕΙΡΙΣΗ ΠΡΟΣΩΠΟ' });
  expect(dup.status).toBe(400);
  expect(JSON.stringify(dup.body)).toContain('Υπάρχει ήδη');
});

test('admin: saving without relation changes does not trip duplicate or inverse checks (Review Focus 1)', async () => {
  const p = await docs.create('api::publisher.publisher', { data: { name: 'Εκδότης Admin Αποθήκευση' } });
  const res = await cm('put', `api::publisher.publisher/${p.documentId}`)
    .send({ name: 'Εκδότης Admin Αποθήκευση', phone: '210', books: { connect: [], disconnect: [] } });
  expect(res.status).toBe(200);
  expect(res.body.data.phone).toBe('210');
});

test('admin: an issue keeps the rules (magazine required, title from the magazine)', async () => {
  const m = await docs.create(MAG, { data: { title: 'Περιοδικό Admin' } });
  const created = await cm('post', BOOK).send({ title: 'λάθος', type: 'Περιοδικό', issueNumber: '1', magazine: { connect: [{ documentId: m.documentId }] } });
  expect(created.status).toBe(201);
  expect(created.body.data.title).toBe('Περιοδικό Admin');
  const noMag = await cm('post', BOOK).send({ title: 'Χ', type: 'Περιοδικό', issueNumber: '2' });
  expect(noMag.status).toBe(400);
});

test('admin: merge moves issues; a record in use cannot be deleted', async () => {
  const from = await docs.create(MAG, { data: { title: 'Συγχώνευση Admin Λάθος' } });
  const to = await docs.create(MAG, { data: { title: 'Συγχώνευση Admin Σωστό' } });
  await docs.create(BOOK, { data: { title: 'x', type: 'Περιοδικό', magazine: from.id, issueNumber: '3' } });
  const merged = await cm('put', `${MAG}/${from.documentId}`).send({ title: from.title, mergeInto: { connect: [{ documentId: to.documentId }] } });
  expect(merged.status).toBe(200);
  expect(await strapi.db.query(MAG).count({ where: { documentId: from.documentId } })).toBe(0);
  const del = await cm('delete', `${MAG}/${to.documentId}`);
  expect(del.status).toBe(400);
  expect(JSON.stringify(del.body)).toContain('τεύχη');
});

test('API: a contributor without role is rejected before components are created', async () => {
  await expect(docs.create(BOOK, { data: { title: 'Συντελεστής χωρίς ρόλο', type: 'Μπροσούρα', contributors: [{ person: 1 }] } }))
    .rejects.toThrow('πρόσωπο και ρόλο');
});
