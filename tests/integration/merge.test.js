'use strict';

const docs = require('../helpers/docs');
const { setupStrapi, cleanupStrapi } = require('../helpers/strapi');

beforeAll(async () => { await setupStrapi(); });
afterAll(async () => { await cleanupStrapi(); });

const es = () => docs;
const PERSON = 'api::person.person';
const PUBLISHER = 'api::publisher.publisher';
const BOOK = 'api::book.book';
const COPY = 'api::copy.copy';
const CONTRIBUTORS = { contributors: { populate: ['person', 'role'] } };

let author;
let translator;
beforeAll(async () => {
  const roles = await es().findMany('api::contributor-role.contributor-role', { sort: 'biblionetTypeId' });
  [author, translator] = roles;
});

const pairs = async (bookId) =>
  (await es().findOne(BOOK, bookId, { populate: CONTRIBUTORS })).contributors.map((c) => [c.person.id, c.role.id]);

test('person merge repoints contributors and removes duplicate person+role (Review Focus 5)', async () => {
  const d = await es().create(PERSON, { data: { name: 'Λοιζίδη Νίκη λάθος' } });
  const x = await es().create(PERSON, { data: { name: 'Νίκη Λοϊζίδη' } });
  const b1 = await es().create(BOOK, { data: { title: 'Σ1', type: 'Μπροσούρα', contributors: [
    { person: d.id, role: author.id }, { person: x.id, role: translator.id },
  ] } });
  const b2 = await es().create(BOOK, { data: { title: 'Σ2', type: 'Μπροσούρα', contributors: [
    { person: d.id, role: author.id }, { person: x.id, role: author.id },
  ] } });

  await es().update(PERSON, d.id, { data: { mergeInto: x.id } });

  expect(await es().findOne(PERSON, d.id)).toBeNull();
  expect(await pairs(b1.id)).toEqual([[x.id, author.id], [x.id, translator.id]]);
  expect(await pairs(b2.id)).toEqual([[x.id, author.id]]);
});

test('Biblionet id moves to the target when only the source has one', async () => {
  const d = await es().create(PERSON, { data: { name: 'Πηγή Biblionet', biblionetPersonId: '777' } });
  const x = await es().create(PERSON, { data: { name: 'Στόχος Τοπικός' } });
  await es().update(PERSON, d.id, { data: { mergeInto: x.id } });
  expect((await es().findOne(PERSON, x.id)).biblionetPersonId).toBe('777');
});

test('two Biblionet persons cannot be merged', async () => {
  const d = await es().create(PERSON, { data: { name: 'Β Ένα', biblionetPersonId: '801' } });
  const x = await es().create(PERSON, { data: { name: 'Β Δύο', biblionetPersonId: '802' } });
  await expect(es().update(PERSON, d.id, { data: { mergeInto: x.id } })).rejects.toThrow('Biblionet');
  expect((await es().findOne(PERSON, d.id, { populate: ['mergeInto'] })).mergeInto).toBeNull();
});

test('self merge and chained target are rejected', async () => {
  const final = await es().create(PERSON, { data: { name: 'Τελικός' } });
  const chained = await es().create(PERSON, { data: { name: 'Ενδιάμεσος' } });
  // mergeInto is ignored on create, so write the pending link directly (as a failed merge would leave it)
  const { joinTable } = strapi.db.metadata.get(PERSON).attributes.mergeInto;
  await strapi.db.connection(joinTable.name).insert({
    [joinTable.joinColumn.name]: chained.id,
    [joinTable.inverseJoinColumn.name]: final.id,
  });
  const d = await es().create(PERSON, { data: { name: 'Πηγή Αλυσίδας' } });
  await expect(es().update(PERSON, d.id, { data: { mergeInto: d.id } })).rejects.toThrow('τον εαυτό της');
  await expect(es().update(PERSON, d.id, { data: { mergeInto: chained.id } })).rejects.toThrow('ήδη');
});

test('publisher merge moves books and magazines', async () => {
  const d = await es().create(PUBLISHER, { data: { name: 'Εκδ λάθος' } });
  const x = await es().create(PUBLISHER, { data: { name: 'Εκδόσεις Σωστές' } });
  const book = await es().create(BOOK, { data: { title: 'Σ3', type: 'Μπροσούρα', publisher: d.id } });
  const mag = await es().create('api::magazine.magazine', { data: { title: 'Περιοδικό Μ', publisher: d.id } });

  await es().update(PUBLISHER, d.id, { data: { mergeInto: x.id } });

  expect((await es().findOne(BOOK, book.id, { populate: ['publisher'] })).publisher.id).toBe(x.id);
  expect((await es().findOne('api::magazine.magazine', mag.id, { populate: ['publisher'] })).publisher.id).toBe(x.id);
  expect(await es().findOne(PUBLISHER, d.id)).toBeNull();
});

test('book merge moves copies and renumbers conflicting copy numbers per library', async () => {
  const lib = await es().create('api::library.library', { data: { name: 'Βιβλιοθήκη Συγχώνευσης' } });
  const d = await es().create(BOOK, { data: { title: 'Μπροσούρα λαθος', type: 'Μπροσούρα' } });
  const x = await es().create(BOOK, { data: { title: 'Μπροσούρα σωστή', type: 'Μπροσούρα' } });
  await es().create(COPY, { data: { copyNumber: 1, publication: x.id, library: lib.id } });
  await es().create(COPY, { data: { copyNumber: 1, publication: d.id, library: lib.id } });
  await es().create(COPY, { data: { copyNumber: 2, publication: d.id, library: lib.id } });

  await es().update(BOOK, d.id, { data: { mergeInto: x.id } });

  const copies = await es().findMany(COPY, { filters: { publication: { id: x.id } }, sort: 'copyNumber' });
  expect(copies.map((c) => c.copyNumber)).toEqual([1, 2, 3]);
  expect(await es().findOne(BOOK, d.id)).toBeNull();
});

test('Biblionet book cannot be merged away; types must match', async () => {
  const bn = await es().create(BOOK, { data: { title: 'Από Biblionet', type: 'Βιβλίο', isbn: '9789602116524', biblionetId: '72584' } });
  const local = await es().create(BOOK, { data: { title: 'Τοπικό', type: 'Βιβλίο', isbn: '9780306406157' } });
  const brochure = await es().create(BOOK, { data: { title: 'Μπροσ', type: 'Μπροσούρα' } });
  await expect(es().update(BOOK, bn.id, { data: { mergeInto: local.id } })).rejects.toThrow('Biblionet');
  await expect(es().update(BOOK, brochure.id, { data: { mergeInto: local.id } })).rejects.toThrow('τύπου');
});

test('publisher merge that would make two brochures identical: clear message, nothing changes', async () => {
  const d = await es().create(PUBLISHER, { data: { name: 'Εκδ Σύγκρουσης Λάθος' } });
  const x = await es().create(PUBLISHER, { data: { name: 'Εκδ Σύγκρουσης Σωστός' } });
  const b1 = await es().create(BOOK, { data: { title: 'Κοινός Τίτλος', type: 'Μπροσούρα', yearPublished: 2000, publisher: d.id } });
  await es().create(BOOK, { data: { title: 'Κοινός Τίτλος', type: 'Μπροσούρα', yearPublished: 2000, publisher: x.id } });

  await expect(es().update(PUBLISHER, d.id, { data: { mergeInto: x.id } })).rejects.toThrow('Συγχωνεύστε πρώτα τις μπροσούρες');

  const source = await es().findOne(PUBLISHER, d.id, { populate: ['mergeInto'] });
  expect(source).not.toBeNull();
  expect(source.mergeInto).toBeNull();
  expect((await es().findOne(BOOK, b1.id, { populate: ['publisher'] })).publisher.id).toBe(d.id);
});
