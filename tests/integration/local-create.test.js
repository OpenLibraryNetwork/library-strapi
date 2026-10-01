'use strict';

jest.mock('../../src/api/book/services/biblionet', () => {
  const actual = jest.requireActual('../../src/api/book/services/biblionet');
  return {
    searchByIsbn: jest.fn(),
    getContributors: jest.fn(),
    getSubjects: jest.fn(),
    getPerson: jest.fn(),
    getCompany: jest.fn(),
    downloadImage: jest.fn(),
    extractData: actual.extractData,
    extractAllData: actual.extractAllData,
  };
});

const docs = require('../helpers/docs');
const request = require('supertest');
const biblionet = require('../../src/api/book/services/biblionet');
const quota = require('../../src/api/book/services/biblionet-quota');
const fx = require('../fixtures/biblionet');
const { setupStrapi, cleanupStrapi } = require('../helpers/strapi');
const { createLibrarian } = require('../helpers/auth');

let jwt;
let library;
let authorRole;
let subject;
beforeAll(async () => {
  await setupStrapi();
  ({ jwt, library } = await createLibrarian(strapi));
  [authorRole] = await docs.findMany('api::contributor-role.contributor-role', { filters: { biblionetTypeId: '1' } });
  subject = await docs.create('api::subject.subject', { data: { subjectTitle: 'Πολιτική', subjectDDC: '320' } });
});
afterAll(async () => { await cleanupStrapi(); });

beforeEach(() => {
  jest.clearAllMocks();
  quota.reset();
  biblionet.searchByIsbn.mockResolvedValue(null);
  biblionet.getContributors.mockResolvedValue(fx.contributors[0]);
  biblionet.getSubjects.mockResolvedValue(fx.subjects[0]);
  biblionet.getPerson.mockResolvedValue(null);
  biblionet.getCompany.mockResolvedValue(fx.company);
  biblionet.downloadImage.mockRejectedValue(new Error('no network in tests'));
});

const post = (path, data) =>
  request(strapi.server.httpServer).post(path).set('Authorization', `Bearer ${jwt}`).send({ data });
const raw = (uid, id) => strapi.db.query(uid).findOne({ where: { id }, populate: ['catalogedBy'] });

describe('persons/local', () => {
  test('201, server-controlled fields are enforced', async () => {
    const res = await post('/api/persons/local', {
      name: 'Άννα Λαμπρίδου', biblionetPersonId: '123', reviewed: true, catalogedBy: 999,
    });
    expect(res.status).toBe(201);
    expect(res.body.source).toBe('local');
    const row = await raw('api::person.person', res.body.data.id);
    expect(row).toMatchObject({ name: 'Άννα Λαμπρίδου', biblionetPersonId: null, reviewed: false });
    expect(row.catalogedBy.id).toBe(library.id);
  });

  test('name is composed from parts', async () => {
    const res = await post('/api/persons/local', { firstname: 'Γιώργος', middlename: 'Κ.', lastname: 'Νικολάου' });
    expect(res.status).toBe(201);
    expect(res.body.data.attributes.name).toBe('Γιώργος Κ. Νικολάου');
  });

  test('duplicate → 409 with candidates, no override possible', async () => {
    const res = await post('/api/persons/local', { name: 'ΑΝΝΑ ΛΑΜΠΡΙΔΟΥ', confirmNotDuplicate: true });
    expect(res.status).toBe(409);
    expect(res.body.candidates.map((c) => c.attributes.name)).toEqual(['Άννα Λαμπρίδου']);
  });

  test('qualifier makes a homonym acceptable', async () => {
    expect((await post('/api/persons/local', { name: 'Άννα Λαμπρίδου', qualifier: 'ζωγράφος' })).status).toBe(201);
  });

  test('no name at all → 400', async () => {
    expect((await post('/api/persons/local', { biography: 'κάτι' })).status).toBe(400);
  });
});

describe('publishers/local', () => {
  test('duplicate of a Biblionet publisher → 409', async () => {
    await docs.create('api::publisher.publisher', { data: { name: 'Νεφέλη', biblionetCompanyId: '212' } });
    expect((await post('/api/publishers/local', { name: 'νεφελη' })).status).toBe(409);
  });

  test('201 with contact fields', async () => {
    const res = await post('/api/publishers/local', { name: 'Αυτοέκδοση Χ', email: 'x@example.org' });
    expect(res.status).toBe(201);
    expect(res.body.data.attributes.email).toBe('x@example.org');
  });
});

describe('books/local', () => {
  let person;
  let publisher;
  beforeAll(async () => {
    person = (await post('/api/persons/local', { name: 'Συγγραφέας Μπροσούρας' })).body.data;
    publisher = (await post('/api/publishers/local', { name: 'Εκδόσεις Μπροσούρας' })).body.data;
  });

  test('brochure 201 with relations; ISBN ignored', async () => {
    const res = await post('/api/books/local', {
      type: 'Μπροσούρα',
      title: 'Για την αυτοοργάνωση',
      yearPublished: 2019,
      isbn: '9789602116524',
      publisher: publisher.id,
      contributors: [{ person: person.id, role: authorRole.id }],
      subjects: [subject.id],
    });
    expect(res.status).toBe(201);
    const a = res.body.data.attributes;
    expect(a.isbn).toBeNull();
    expect(a.reviewed).toBe(false);
    expect(a.contributors[0].person.data.attributes.name).toBe('Συγγραφέας Μπροσούρας');
    expect(a.publisher.data.id).toBe(publisher.id);
    expect(a.subjects.data[0].id).toBe(subject.id);
    expect(biblionet.searchByIsbn).not.toHaveBeenCalled();
  });

  test('brochure duplicate → 409', async () => {
    const res = await post('/api/books/local', {
      type: 'Μπροσούρα', title: 'ΓΙΑ ΤΗΝ ΑΥΤΟΟΡΓΑΝΩΣΗ', yearPublished: 2019, publisher: publisher.id,
    });
    expect(res.status).toBe(409);
    expect(res.body.candidates[0].attributes.title).toBe('Για την αυτοοργάνωση');
  });

  test('ISBN book not in Biblionet → 201 local', async () => {
    const res = await post('/api/books/local', { type: 'Βιβλίο', title: 'Foreign Book', isbn: '0-8044-2957-X' });
    expect(res.status).toBe(201);
    expect(res.body.data.attributes).toMatchObject({ isbn: '9780804429573', biblionetId: null });
    // ISBN-13 lookup + ISBN-10 retry
    expect(biblionet.searchByIsbn.mock.calls.map((c) => c[0])).toEqual(['9780804429573', '080442957X']);
  });

  test('ISBN book already in catalog → 409', async () => {
    const res = await post('/api/books/local', { type: 'Βιβλίο', title: 'Άλλος τίτλος', isbn: '9780804429573' });
    expect(res.status).toBe(409);
    expect(biblionet.searchByIsbn).not.toHaveBeenCalled();
  });

  test('ISBN book found in Biblionet → imported instead, local data ignored', async () => {
    biblionet.searchByIsbn.mockResolvedValue(fx.title);
    const res = await post('/api/books/local', { type: 'Βιβλίο', title: 'Λάθος τίτλος', isbn: '978-960-211-652-4' });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('biblionet');
    expect(res.body.data.attributes.title).toBe('Θεραπείας συνέχεια');
  });

  test('Biblionet down → 502 and nothing is created', async () => {
    biblionet.searchByIsbn.mockRejectedValue(new Error('timeout'));
    const res = await post('/api/books/local', { type: 'Βιβλίο', title: 'Κάτι', isbn: '978-0-306-40615-7' });
    expect(res.status).toBe(502);
    expect(await strapi.db.query('api::book.book').count({ where: { isbn: '9780306406157' } })).toBe(0);
  });

  test.each([
    ['invalid ISBN', { type: 'Βιβλίο', title: 'Κ', isbn: '123' }],
    ['periodical without magazine', { type: 'Περιοδικό', title: 'Κ', issueNumber: '1' }],
    ['missing title', { type: 'Μπροσούρα' }],
    ['unknown person', { type: 'Μπροσούρα', title: 'Κ1', contributors: [{ person: 999999, role: 1 }] }],
    ['contributor without role', { type: 'Μπροσούρα', title: 'Κ2', contributors: [{ person: 1 }] }],
    ['non-integer year', { type: 'Μπροσούρα', title: 'Κ3', yearPublished: 'πέρσι' }],
  ])('400: %s', async (_label, data) => {
    expect((await post('/api/books/local', data)).status).toBe(400);
  });
});
