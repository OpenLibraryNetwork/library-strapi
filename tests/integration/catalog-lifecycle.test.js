'use strict';

const docs = require('../helpers/docs');
const { setupStrapi, cleanupStrapi } = require('../helpers/strapi');

beforeAll(async () => { await setupStrapi(); });
afterAll(async () => { await cleanupStrapi(); });

const es = () => docs;
const raw = (uid, id) => strapi.db.query(uid).findOne({ where: { id } });
const PERSON = 'api::person.person';
const PUBLISHER = 'api::publisher.publisher';
const BOOK = 'api::book.book';

describe('person', () => {
  test('computes keys and ignores client-sent keys', async () => {
    const p = await es().create(PERSON, { data: { name: 'Νίκη Λοϊζίδη', searchKey: 'hack', matchKey: 'hack' } });
    const row = await raw(PERSON, p.id);
    expect(row.searchKey).toBe('νικη λοιζιδη');
    expect(row.matchKey).toBe('νικη λοιζιδη|');
  });

  test('local duplicate is rejected', async () => {
    await expect(es().create(PERSON, { data: { name: 'ΝΙΚΗ ΛΟΪΖΊΔΗ' } })).rejects.toThrow('Υπάρχει ήδη');
  });

  test('same name with qualifier is allowed', async () => {
    const p = await es().create(PERSON, { data: { name: 'Νίκη Λοϊζίδη', qualifier: '1950-' } });
    expect(p.id).toBeDefined();
  });

  test('local person with the name of a Biblionet person is rejected', async () => {
    await es().create(PERSON, { data: { name: 'Pino Corrias', biblionetPersonId: '958' } });
    await expect(es().create(PERSON, { data: { name: 'Pino Corrias' } })).rejects.toThrow('Υπάρχει ήδη');
  });

  test('Biblionet homonyms are allowed', async () => {
    const p = await es().create(PERSON, { data: { name: 'Pino Corrias', biblionetPersonId: '999' } });
    expect(p.id).toBeDefined();
  });

  test('update of an unrelated field keeps keys', async () => {
    const p = await es().create(PERSON, { data: { name: 'Μαρία Ιωάννου' } });
    await es().update(PERSON, p.id, { data: { reviewed: true } });
    expect((await raw(PERSON, p.id)).matchKey).toBe('μαρια ιωαννου|');
  });

  test('duplicate error carries candidates', async () => {
    const existing = await es().create(PERSON, { data: { name: 'Κώστας Δήμου' } });
    try {
      await es().create(PERSON, { data: { name: 'Κώστας Δήμου' } });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.name).toBe('DuplicateRecordError');
      expect(e.details.candidates).toEqual([{ id: existing.id }]);
    }
  });
});

describe('publisher', () => {
  test('local duplicate is rejected, qualifier allows it', async () => {
    await es().create(PUBLISHER, { data: { name: 'Εκδόσεις Χ' } });
    await expect(es().create(PUBLISHER, { data: { name: 'εκδοσεις χ' } })).rejects.toThrow('Υπάρχει ήδη');
    const q = await es().create(PUBLISHER, { data: { name: 'Εκδόσεις Χ', qualifier: 'Θεσσαλονίκη' } });
    expect(q.id).toBeDefined();
  });
});

describe('book', () => {
  let p1;
  let p2;
  let p3;
  beforeAll(async () => {
    p1 = await es().create(PUBLISHER, { data: { name: 'Π-Ένα' } });
    p2 = await es().create(PUBLISHER, { data: { name: 'Π-Δύο' } });
    p3 = await es().create(PUBLISHER, { data: { name: 'Π-Τρία' } });
  });

  test('brochure duplicate on title+publisher+year is rejected', async () => {
    await es().create(BOOK, { data: { title: 'Μανιφέστο', type: 'Μπροσούρα', publisher: p1.id, yearPublished: 2020 } });
    await expect(
      es().create(BOOK, { data: { title: 'ΜΑΝΙΦΕΣΤΟ', type: 'Μπροσούρα', publisher: p1.id, yearPublished: 2020 } })
    ).rejects.toThrow('Υπάρχει ήδη');
  });

  test('same title with different publisher is allowed', async () => {
    const b = await es().create(BOOK, { data: { title: 'Μανιφέστο', type: 'Μπροσούρα', publisher: p2.id, yearPublished: 2020 } });
    expect(b.id).toBeDefined();
  });

  test('admin connect/disconnect payload recomputes matchKey (Review Focus 1)', async () => {
    const b = await es().create(BOOK, { data: { title: 'Μανιφέστο', type: 'Μπροσούρα', publisher: p3.id, yearPublished: 2020 } });
    await expect(
      es().update(BOOK, b.id, { data: { publisher: { connect: [{ id: p1.id }], disconnect: [{ id: p3.id }] } } })
    ).rejects.toThrow('Υπάρχει ήδη');
    await es().update(BOOK, b.id, { data: { yearPublished: 2021 } });
    expect((await raw(BOOK, b.id)).matchKey).toBe(`μανιφεστο|${p3.id}|2021`);
  });

  test('searchKey from title and subtitle', async () => {
    const b = await es().create(BOOK, { data: { title: 'Θεραπείας συνέχεια', subtitle: 'Αφήγημα', type: 'Μπροσούρα' } });
    expect((await raw(BOOK, b.id)).searchKey).toBe('θεραπειασ συνεχεια αφηγημα');
  });

  test('ISBN is normalized to ISBN-13', async () => {
    const b = await es().create(BOOK, { data: { title: 'Τ', type: 'Βιβλίο', isbn: '960-211-652-8' } });
    expect((await raw(BOOK, b.id)).isbn).toBe('9789602116524');
  });

  test('invalid ISBN is rejected', async () => {
    await expect(es().create(BOOK, { data: { title: 'Τ', type: 'Βιβλίο', isbn: '978-960-211-652-5' } }))
      .rejects.toThrow('Μη έγκυρο ISBN');
  });

  test('contributor without role is rejected', async () => {
    const person = await es().create(PERSON, { data: { name: 'Χωρίς Ρόλο' } });
    await expect(
      es().create(BOOK, { data: { title: 'Κ', type: 'Μπροσούρα', contributors: [{ person: person.id }] } })
    ).rejects.toThrow('πρόσωπο και ρόλο');
  });
  test('rejected update leaves contributors untouched (atomic update)', async () => {
    const [role] = await es().findMany('api::contributor-role.contributor-role', { filters: { biblionetTypeId: '1' } });
    const a = await es().create(PERSON, { data: { name: 'Ατομικό Α' } });
    const b = await es().create(PERSON, { data: { name: 'Ατομικό Β' } });
    await es().create(BOOK, { data: { title: 'Διπλό', type: 'Μπροσούρα', yearPublished: 1999 } });
    const book = await es().create(BOOK, {
      data: { title: 'Μοναδικό', type: 'Μπροσούρα', yearPublished: 1999, contributors: [{ person: a.id, role: role.id }] },
    });
    await expect(
      es().update(BOOK, book.id, { data: { title: 'Διπλό', contributors: [{ person: b.id, role: role.id }] } })
    ).rejects.toThrow('Υπάρχει ήδη');
    const after = await es().findOne(BOOK, book.id, { populate: { contributors: { populate: ['person'] } } });
    expect(after.title).toBe('Μοναδικό');
    expect(after.contributors.map((c) => c.person.id)).toEqual([a.id]);
  });
});
