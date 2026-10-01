'use strict';

const fx = require('../fixtures/biblionet');
const m = require('../../src/api/book/services/biblionet-mapper');
const { extractAllData } = require('../../src/api/book/services/biblionet');

describe('mapTitle', () => {
  const t = m.mapTitle(fx.title);
  test('basic fields', () => {
    expect(t.title).toBe('Θεραπείας συνέχεια');
    expect(t.pages).toBe(119);
    expect(t.yearPublished).toBe(2002);
    expect(t.price).toBeCloseTo(5.83);
    expect(t.weight).toBe(128);
    expect(t.binding).toBe('Μαλακό εξώφυλλο');
    expect(t.biblionetId).toBe('72584');
    expect(t.biblionetCategoryId).toBe('39');
  });
  test('empty strings become null', () => {
    expect(t.subtitle).toBeNull();
    expect(t.language).toBeNull();
    expect(t.originalLanguage).toBeNull();
    expect(t.edition).toBeNull();
  });
  test('missing FirstPublishDate gives null year', () => {
    expect(m.mapTitle({ ...fx.title, FirstPublishDate: null }).yearPublished).toBeNull();
  });
  test('non-numeric PageNo gives null', () => {
    expect(m.mapTitle({ ...fx.title, PageNo: 'άγνωστο' }).pages).toBeNull();
  });
});

describe('mapContributors', () => {
  test('maps all roles in PresentOrder', () => {
    expect(m.mapContributors(extractAllData(fx.contributors))).toEqual([
      { biblionetPersonId: '958', fullName: 'Pino Corrias', roleTypeId: '1', roleName: 'Συγγραφέας', order: 1 },
      { biblionetPersonId: '1232', fullName: 'Παναγιώτης Σκόνδρας', roleTypeId: '2', roleName: 'Μεταφραστής', order: 2 },
    ]);
  });
  test('sorts by PresentOrder, not array position', () => {
    const [a, b] = fx.contributors[0];
    const out = m.mapContributors([b, a]);
    expect(out.map((c) => c.biblionetPersonId)).toEqual(['958', '1232']);
  });
  test('drops duplicate person+role and rows without ContributorID', () => {
    const [a] = fx.contributors[0];
    const out = m.mapContributors([a, { ...a }, { ...a, ContributorID: '' }]);
    expect(out).toHaveLength(1);
  });
  test('same person with two roles is kept twice', () => {
    const [a] = fx.contributors[0];
    const out = m.mapContributors([a, { ...a, ContributorTypeID: '2', ContributorType: 'Μεταφραστής', PresentOrder: '2' }]);
    expect(out).toHaveLength(2);
  });
});

describe('mapPerson', () => {
  const row = fx.contributors[0][1];
  test('uses ContributorFullName and enrichment fields', () => {
    expect(m.mapPerson(row, fx.person)).toEqual({
      name: 'Παναγιώτης Σκόνδρας',
      firstname: 'Παναγιώτης',
      middlename: null,
      lastname: 'Σκόνδρας',
      bornYear: null,
      deathYear: null,
      biography: 'Μεταφραστής.',
      biblionetPersonId: '1232',
    });
  });
  test('works without enrichment', () => {
    const p = m.mapPerson(row, null);
    expect(p.name).toBe('Παναγιώτης Σκόνδρας');
    expect(p.firstname).toBeNull();
  });
});

describe('mapCompany', () => {
  test('maps TelephoneNumner typo and trims address', () => {
    expect(m.mapCompany(fx.title, fx.company)).toEqual({
      name: 'Νεφέλη',
      alternativeName: null,
      address: 'Ασκληπιού 57\r\n106 80 Αθήνα',
      phone: '210 3607744',
      email: 'info@nefeli.gr',
      website: 'www.nefeli.gr',
      biblionetCompanyId: '212',
    });
  });
  test('works without enrichment', () => {
    const c = m.mapCompany(fx.title, null);
    expect(c.name).toBe('Νεφέλη');
    expect(c.phone).toBeNull();
  });
});

describe('mapSubjects', () => {
  test('maps subjects', () => {
    expect(m.mapSubjects(extractAllData(fx.subjects))).toEqual([
      { biblionetSubjectId: '20', subjectTitle: 'Νεοελληνική πεζογραφία - Προσωπικές αφηγήσεις', subjectDDC: '889.3' },
    ]);
  });
});

describe('extractAllData', () => {
  test('error object means no results', () => {
    expect(extractAllData(fx.error)).toEqual([]);
  });
});
