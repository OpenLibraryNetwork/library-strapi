'use strict';

const request = require('supertest');
const docs = require('../helpers/docs');
const { setupStrapi, cleanupStrapi } = require('../helpers/strapi');
const { adminToken } = require('../helpers/admin');
const { createLibrarian } = require('../helpers/auth');

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

test('API: contributors given by documentId (the Strapi 5 REST shape) are accepted', async () => {
  const person = await docs.create(PERSON, { data: { name: 'Συντελεστής Με DocumentId' } });
  const [role] = await docs.findMany('api::contributor-role.contributor-role', { sort: 'biblionetTypeId' });
  const plain = await strapi.documents(BOOK).create({ data: { title: 'Συντελεστές με documentId', type: 'Μπροσούρα',
    contributors: [{ person: person.documentId, role: role.documentId }] }, populate: { contributors: { populate: ['person'] } } });
  expect(plain.contributors[0].person.documentId).toBe(person.documentId);
  const connected = await strapi.documents(BOOK).create({ data: { title: 'Συντελεστές με connect', type: 'Μπροσούρα',
    contributors: [{ person: { connect: [{ documentId: person.documentId }] }, role: { connect: [{ documentId: role.documentId }] } }] } });
  expect(connected.documentId).toBeDefined();
});

describe('admin: copies', () => {
  let library;
  let book;
  beforeAll(async () => {
    await createLibrarian(strapi, { libraryName: 'Βιβλιοθήκη Χρήστη' }); // a users-permissions user that may share the admin's id
    library = await docs.create('api::library.library', { data: { name: 'Βιβλιοθήκη Admin' } });
    book = await docs.create(BOOK, { data: { title: 'Έντυπο Αντιτύπων Admin', type: 'Μπροσούρα' } });
  });

  test('creating a copy in the admin keeps the library the admin chose', async () => {
    const res = await cm('post', 'api::copy.copy').send({ copyNumber: 1, condition: 'NEW',
      publication: { connect: [{ documentId: book.documentId }] }, library: { connect: [{ documentId: library.documentId }] } });
    expect(res.status).toBe(201);
    const saved = await strapi.db.query('api::copy.copy').findOne({ where: { documentId: res.body.data.documentId }, populate: ['library'] });
    expect(saved.library.documentId).toBe(library.documentId);
  });

  test('saving a copy in the admin without relation changes works (Review Focus 1)', async () => {
    const copy = await docs.create('api::copy.copy', { data: { copyNumber: 2, publication: book.id, library: library.id } });
    const res = await cm('put', `api::copy.copy/${copy.documentId}`).send({ copyNumber: 2, condition: 'GOOD',
      publication: { connect: [], disconnect: [] }, library: { connect: [], disconnect: [] } });
    expect(res.status).toBe(200);
    expect(res.body.data.condition).toBe('GOOD');
  });

  test('moving a copy to another library in the admin is refused with a message', async () => {
    const other = await docs.create('api::library.library', { data: { name: 'Άλλη Βιβλιοθήκη Admin' } });
    const copy = await docs.create('api::copy.copy', { data: { copyNumber: 3, publication: book.id, library: library.id } });
    const res = await cm('put', `api::copy.copy/${copy.documentId}`).send({ copyNumber: 3,
      library: { connect: [{ documentId: other.documentId }], disconnect: [] } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('βιβλιοθήκη');
  });
});
