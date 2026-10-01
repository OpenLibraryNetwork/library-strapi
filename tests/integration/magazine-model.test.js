'use strict';

const docs = require('../helpers/docs');
const { setupStrapi, cleanupStrapi } = require('../helpers/strapi');

beforeAll(async () => { await setupStrapi(); });
afterAll(async () => { await cleanupStrapi(); });

const es = () => docs;
const MAG = 'api::magazine.magazine';
const BOOK = 'api::book.book';
const COPY = 'api::copy.copy';

const issue = (magazine, data) =>
  es().create(BOOK, { data: { title: 'αγνοείται', type: 'Περιοδικό', magazine, ...data } });

describe('magazine', () => {
  test('ISSN is normalized; invalid ISSN is rejected', async () => {
    const m = await es().create(MAG, { data: { title: 'Κανονικοποίηση', issn: '22415580' } });
    expect(m.issn).toBe('2241-5580');
    await expect(es().create(MAG, { data: { title: 'Λάθος', issn: '2241-5581' } })).rejects.toThrow('Μη έγκυρο ISSN');
  });

  test('local duplicate (title + qualifier) is rejected; qualifier separates homonyms', async () => {
    await es().create(MAG, { data: { title: 'Αναρχία' } });
    await expect(es().create(MAG, { data: { title: 'ΑΝΑΡΧΙΑ' } })).rejects.toThrow('Υπάρχει ήδη');
    const other = await es().create(MAG, { data: { title: 'Αναρχία', qualifier: 'Θεσσαλονίκη' } });
    expect(other.id).toBeDefined();
  });

  test('a National Library record is not blocked by a local homonym', async () => {
    await es().create(MAG, { data: { title: 'Ομώνυμο Περιοδικό' } });
    const nlg = await es().create(MAG, { data: { title: 'Ομώνυμο Περιοδικό', nlgBiblionumber: '900001' } });
    expect(nlg.id).toBeDefined();
  });

  test('magazine with issues cannot be deleted; without issues can', async () => {
    const used = await es().create(MAG, { data: { title: 'Με τεύχη' } });
    const free = await es().create(MAG, { data: { title: 'Χωρίς τεύχη' } });
    await issue(used.id, { issueNumber: '1' });
    await expect(es().delete(MAG, used.id)).rejects.toThrow('τεύχη');
    await es().delete(MAG, free.id);
    expect(await es().findOne(MAG, free.id)).toBeNull();
  });

  test('issues cannot be moved from the magazine side (inverse relation)', async () => {
    const a = await es().create(MAG, { data: { title: 'Αντίστροφο Α' } });
    const b = await es().create(MAG, { data: { title: 'Αντίστροφο Β' } });
    const i = await issue(a.id, { issueNumber: '1' });
    await expect(
      es().update(MAG, b.id, { data: { issues: { connect: [{ id: i.id }], disconnect: [] } } })
    ).rejects.toThrow('τεύχους');
    const normal = await es().update(MAG, b.id, { data: { place: 'Αθήνα', issues: { connect: [], disconnect: [] } } });
    expect(normal.place).toBe('Αθήνα');
  });

  test('renaming a magazine renames its issues (Review Focus 4)', async () => {
    const m = await es().create(MAG, { data: { title: 'Παλιός Τίτλος' } });
    const i = await issue(m.id, { issueNumber: '2' });
    await es().update(MAG, m.id, { data: { title: 'Νέος Τίτλος' } });
    expect((await es().findOne(BOOK, i.id)).title).toBe('Νέος Τίτλος');
  });
});

describe('issue (book of type Περιοδικό)', () => {
  let mag;
  beforeAll(async () => { mag = await es().create(MAG, { data: { title: 'Τεύχη Δοκιμής' } }); });

  test('number or period is required; magazine is required', async () => {
    await expect(issue(mag.id, {})).rejects.toThrow('αριθμό ή περίοδο');
    await expect(es().create(BOOK, { data: { title: 'Χ', type: 'Περιοδικό', issueNumber: '1' } })).rejects.toThrow('περιοδικό');
    const byPeriod = await issue(mag.id, { publicationMonthYear: 'Άνοιξη 2020' });
    expect(byPeriod.issueNumber).toBeNull();
  });

  test('issue number is text', async () => {
    const i = await issue(mag.id, { issueNumber: '12-13' });
    expect(i.issueNumber).toBe('12-13');
  });

  test('duplicate issue is rejected; the same number in another magazine is allowed', async () => {
    await issue(mag.id, { issueNumber: '7' });
    await expect(issue(mag.id, { issueNumber: 'τεύχ. 07' })).rejects.toThrow('Υπάρχει ήδη');
    const other = await es().create(MAG, { data: { title: 'Άλλο Περιοδικό Τευχών' } });
    expect((await issue(other.id, { issueNumber: '7' })).id).toBeDefined();
  });

  test('without a number, the same period is a duplicate', async () => {
    await issue(mag.id, { publicationMonthYear: 'Φθινόπωρο 2021' });
    await expect(issue(mag.id, { publicationMonthYear: 'ΦΘΙΝΟΠΩΡΟ 2021' })).rejects.toThrow('Υπάρχει ήδη');
  });
});

describe('merge', () => {
  test('magazine merge moves issues and takes the target title', async () => {
    const d = await es().create(MAG, { data: { title: 'Περιοδικό Λάθος' } });
    const x = await es().create(MAG, { data: { title: 'Περιοδικό Σωστό' } });
    const i = await issue(d.id, { issueNumber: '3' });
    await es().update(MAG, d.id, { data: { mergeInto: x.id } });
    const moved = await es().findOne(BOOK, i.id, { populate: ['magazine'] });
    expect(moved.magazine.id).toBe(x.id);
    expect(moved.title).toBe('Περιοδικό Σωστό');
    expect(await es().findOne(MAG, d.id)).toBeNull();
  });

  test('clashing issue numbers: clear message, nothing changes (Review Focus 4)', async () => {
    const d = await es().create(MAG, { data: { title: 'Σύγκρουση Λάθος' } });
    const x = await es().create(MAG, { data: { title: 'Σύγκρουση Σωστό' } });
    const i = await issue(d.id, { issueNumber: '4' });
    await issue(x.id, { issueNumber: '04' });
    await expect(es().update(MAG, d.id, { data: { mergeInto: x.id } })).rejects.toThrow('Συγχωνεύστε πρώτα τα τεύχη');
    expect((await es().findOne(BOOK, i.id, { populate: ['magazine'] })).magazine.id).toBe(d.id);
    expect(await es().findOne(MAG, d.id)).not.toBeNull();
  });

  test('two National Library records are not merged', async () => {
    const a = await es().create(MAG, { data: { title: 'ΕΒΕ Α', nlgBiblionumber: '900101' } });
    const b = await es().create(MAG, { data: { title: 'ΕΒΕ Β', nlgBiblionumber: '900102' } });
    await expect(es().update(MAG, a.id, { data: { mergeInto: b.id } })).rejects.toThrow('Εθνική Βιβλιοθήκη');
  });

  test('issue merge moves copies (issues are books)', async () => {
    const m = await es().create(MAG, { data: { title: 'Συγχώνευση Τευχών' } });
    const d = await issue(m.id, { issueNumber: '8', publicationMonthYear: 'λάθος' });
    const x = await issue(m.id, { issueNumber: '9' });
    await es().create(COPY, { data: { copyNumber: 1, publication: d.id } });
    await es().update(BOOK, d.id, { data: { mergeInto: x.id } });
    expect(await es().count(COPY, { filters: { publication: { id: x.id } } })).toBe(1);
  });
});

describe('admin edits of issues (2γ minor M-6)', () => {
  test('an issue always takes its magazine\'s title, also on create and when moved', async () => {
    const a = await es().create(MAG, { data: { title: 'Διαχείριση Α' } });
    const b = await es().create(MAG, { data: { title: 'Διαχείριση Β' } });
    const i = await es().create(BOOK, { data: { title: 'Λάθος τίτλος', type: 'Περιοδικό', magazine: a.id, issueNumber: '1' } });
    expect(i.title).toBe('Διαχείριση Α');
    const moved = await es().update(BOOK, i.id, {
      data: { type: 'Περιοδικό', title: 'Λάθος ξανά', magazine: { connect: [{ id: b.id }], disconnect: [] } },
    });
    expect(moved.title).toBe('Διαχείριση Β');
  });

  test('an admin save that keeps the magazine unchanged still works', async () => {
    const m = await es().create(MAG, { data: { title: 'Διαχείριση Γ' } });
    const i = await es().create(BOOK, { data: { title: 'Χ', type: 'Περιοδικό', magazine: m.id, issueNumber: '2' } });
    const saved = await es().update(BOOK, i.id, {
      data: { type: 'Περιοδικό', pages: 40, magazine: { connect: [], disconnect: [] } },
    });
    expect(saved.pages).toBe(40);
  });

  test('disconnecting the magazine in the admin is rejected', async () => {
    const m = await es().create(MAG, { data: { title: 'Διαχείριση Δ' } });
    const i = await es().create(BOOK, { data: { title: 'Χ', type: 'Περιοδικό', magazine: m.id, issueNumber: '3' } });
    await expect(es().update(BOOK, i.id, {
      data: { type: 'Περιοδικό', magazine: { connect: [], disconnect: [{ id: m.id }] } },
    })).rejects.toThrow('περιοδικό');
    expect((await es().findOne(BOOK, i.id, { populate: ['magazine'] })).magazine.id).toBe(m.id);
  });
});
