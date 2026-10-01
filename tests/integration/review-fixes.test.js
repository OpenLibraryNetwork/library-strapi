'use strict';

const docs = require('../helpers/docs');
const { setupStrapi, cleanupStrapi } = require('../helpers/strapi');

beforeAll(async () => { await setupStrapi(); });
afterAll(async () => { await cleanupStrapi(); });

const es = () => docs;
const PERSON = 'api::person.person';
const PUBLISHER = 'api::publisher.publisher';
const BOOK = 'api::book.book';

// better-sqlite3's SqliteError is not a real Error and its native addon keeps the constructor from the
// first test file's realm, so `rejects.toThrow` misses it when another suite ran earlier in the process.
const rejectsUnique = (promise) => expect(promise).rejects.toMatchObject({ message: expect.stringMatching(/unique/i) });

describe('local record that later gets a Biblionet homonym (review #1)', () => {
  test('can still be edited', async () => {
    const local = await es().create(PERSON, { data: { name: 'Ομώνυμη Συγγραφέας' } });
    await es().create(PERSON, { data: { name: 'Ομώνυμη Συγγραφέας', biblionetPersonId: '5001' } });
    const updated = await es().update(PERSON, local.id, { data: { reviewed: true } });
    expect(updated.reviewed).toBe(true);
  });

  test('can be merged into the Biblionet record', async () => {
    const local = await es().create(PERSON, { data: { name: 'Ομώνυμος Εκδότης Πρόσωπο' } });
    const bn = await es().create(PERSON, { data: { name: 'Ομώνυμος Εκδότης Πρόσωπο', biblionetPersonId: '5002' } });
    await es().update(PERSON, local.id, { data: { mergeInto: bn.id } });
    expect(await es().findOne(PERSON, local.id)).toBeNull();
    expect((await es().findOne(PERSON, bn.id)).biblionetPersonId).toBe('5002');
  });

  test('a local publisher can be merged into its Biblionet homonym', async () => {
    const local = await es().create(PUBLISHER, { data: { name: 'Εκδόσεις Ομώνυμες' } });
    const bn = await es().create(PUBLISHER, { data: { name: 'Εκδόσεις Ομώνυμες', biblionetCompanyId: '6001' } });
    await es().update(PUBLISHER, local.id, { data: { mergeInto: bn.id } });
    expect(await es().findOne(PUBLISHER, local.id)).toBeNull();
  });

  test('renaming a local record INTO an existing name is still rejected', async () => {
    await es().create(PERSON, { data: { name: 'Υπάρχον Όνομα' } });
    const other = await es().create(PERSON, { data: { name: 'Άλλο Όνομα' } });
    await expect(es().update(PERSON, other.id, { data: { name: 'ΥΠΑΡΧΟΝ ΟΝΟΜΑ' } })).rejects.toThrow('Υπάρχει ήδη');
  });
});

describe('database-level unique constraints (review #2)', () => {
  const rawInsertTwice = async (table, row) => {
    const knex = strapi.db.connection;
    await knex(table).insert(row);
    return knex(table).insert(row);
  };

  test.each([
    ['persons', { name: 'Δ1', biblionet_person_id: 'u-1', reviewed: false }],
    ['publishers', { name: 'Δ2', biblionet_company_id: 'u-2', reviewed: false }],
    ['subjects', { subject_title: 'Δ3', biblionet_subject_id: 'u-3' }],
    ['contributor_roles', { name: 'Ρόλος Δ4', biblionet_type_id: 'u-4' }],
    ['books', { title: 'Δ5', type: 'Βιβλίο', isbn: '9780000000002', reviewed: false }],
  ])('%s rejects a duplicate identifier at the database level', async (table, row) => {
    await rejectsUnique(rawInsertTwice(table, row));
  });

  test('books.biblionet_id is unique', async () => {
    const knex = strapi.db.connection;
    await knex('books').insert({ title: 'Δ6', type: 'Βιβλίο', isbn: '9780000000019', biblionet_id: 'u-6', reviewed: false });
    await rejectsUnique(
      knex('books').insert({ title: 'Δ7', type: 'Βιβλίο', isbn: '9780000000026', biblionet_id: 'u-6', reviewed: false })
    );
  });

  test('many NULL identifiers are allowed (local records)', async () => {
    const knex = strapi.db.connection;
    await knex('persons').insert({ name: 'Χωρίς ID 1', reviewed: false });
    await knex('persons').insert({ name: 'Χωρίς ID 2', reviewed: false });
  });

  test('admin cannot store a duplicate ISBN by typing its ISBN-10 form', async () => {
    await es().create(BOOK, { data: { title: 'Πρωτότυπο', type: 'Βιβλίο', isbn: '9789602116524' } });
    await rejectsUnique(es().create(BOOK, { data: { title: 'Αντίγραφο', type: 'Βιβλίο', isbn: '960-211-652-8' } }));
    expect(await strapi.db.query(BOOK).count({ where: { isbn: '9789602116524' } })).toBe(1);
  });
});

describe('inverse-side relation edits from the admin (review #4)', () => {
  test('publisher form cannot move books (their keys would go stale)', async () => {
    const p1 = await es().create(PUBLISHER, { data: { name: 'Αντίστροφος Α' } });
    const p2 = await es().create(PUBLISHER, { data: { name: 'Αντίστροφος Β' } });
    const book = await es().create(BOOK, { data: { title: 'Αντιστροφή', type: 'Μπροσούρα', publisher: p1.id } });
    await expect(
      es().update(PUBLISHER, p2.id, { data: { books: { connect: [{ id: book.id }], disconnect: [] } } })
    ).rejects.toThrow('εγγραφή του εντύπου');
    expect((await es().findOne(BOOK, book.id, { populate: ['publisher'] })).publisher.id).toBe(p1.id);
  });

  test('a normal publisher save with empty connect/disconnect still works', async () => {
    const p = await es().create(PUBLISHER, { data: { name: 'Κανονικός Εκδότης' } });
    const updated = await es().update(PUBLISHER, p.id, { data: { phone: '210', books: { connect: [], disconnect: [] } } });
    expect(updated.phone).toBe('210');
  });

  test('book form cannot move copies', async () => {
    const a = await es().create(BOOK, { data: { title: 'Αντίτυπα Α', type: 'Μπροσούρα' } });
    const b = await es().create(BOOK, { data: { title: 'Αντίτυπα Β', type: 'Μπροσούρα' } });
    const copy = await es().create('api::copy.copy', { data: { copyNumber: 1, publication: a.id } });
    await expect(
      es().update(BOOK, b.id, { data: { copies: { connect: [{ id: copy.id }], disconnect: [] } } })
    ).rejects.toThrow('Αντίτυπα');
    expect((await es().findOne('api::copy.copy', copy.id, { populate: ['publication'] })).publication.id).toBe(a.id);
  });
});

describe('mergeInto on create is ignored (deferred minor #2)', () => {
  test.each([
    [PERSON, { name: 'Νέο με mergeInto' }, { name: 'Στόχος νέου' }],
    [PUBLISHER, { name: 'Νέος Εκδ με mergeInto' }, { name: 'Στόχος Εκδ' }],
    [BOOK, { title: 'Νέα μπροσ με mergeInto', type: 'Μπροσούρα' }, { title: 'Στόχος μπροσ', type: 'Μπροσούρα' }],
  ])('%s', async (uid, data, targetData) => {
    const target = await es().create(uid, { data: targetData });
    const created = await es().create(uid, { data: { ...data, mergeInto: target.id } });
    const row = await es().findOne(uid, created.id, { populate: ['mergeInto'] });
    expect(row.mergeInto).toBeNull();
  });
});
