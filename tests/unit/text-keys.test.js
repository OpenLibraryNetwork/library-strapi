'use strict';

const { normalize, tokenize, buildSearchKey, buildMatchKey } = require('../../src/utils/text-keys');

describe('normalize', () => {
  test('removes Greek accents and diaeresis, lowercases', () => {
    expect(normalize('Λοϊζίδη')).toBe('λοιζιδη');
  });
  test('uppercase accented letters match lowercase (Review Focus 3)', () => {
    expect(normalize('ΛΟΪΖΊΔΗΣ')).toBe(normalize('Λοϊζίδης'));
  });
  test('final sigma becomes sigma', () => {
    expect(normalize('Νίκος')).toBe('νικοσ');
  });
  test('punctuation becomes space and spaces collapse', () => {
    expect(normalize('  Λοϊζίδη,   Νίκη. ')).toBe('λοιζιδη νικη');
  });
  test('mixed Latin/Greek text and digits', () => {
    expect(normalize('Café 1984 Ελιά')).toBe('cafe 1984 ελια');
  });
  test('null and undefined give empty string', () => {
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
  });
});

describe('tokenize', () => {
  test('splits normalized text into words', () => {
    expect(tokenize('Λοϊζίδη  Νίκη')).toEqual(['λοιζιδη', 'νικη']);
  });
  test('empty input gives empty array', () => {
    expect(tokenize('  ,. ')).toEqual([]);
  });
});

describe('buildSearchKey', () => {
  test('joins non-empty parts', () => {
    expect(buildSearchKey('Θεραπείας συνέχεια', null, 'Β΄ τόμος')).toBe('θεραπειασ συνεχεια β τομοσ');
  });
});

describe('buildMatchKey', () => {
  test('person without qualifier', () => {
    expect(buildMatchKey('person', { name: 'Νίκη Λοϊζίδη' })).toBe('νικη λοιζιδη|');
  });
  test('person with qualifier differs from without', () => {
    expect(buildMatchKey('person', { name: 'Γιάννης Παπαδόπουλος', qualifier: '1950-' }))
      .toBe('γιαννησ παπαδοπουλοσ|1950');
  });
  test('publisher', () => {
    expect(buildMatchKey('publisher', { name: 'Νεφέλη', qualifier: null })).toBe('νεφελη|');
  });
  test('brochure uses title, publisher id and year', () => {
    expect(buildMatchKey('brochure', { title: 'Μανιφέστο', publisherId: 7, yearPublished: 2020 }))
      .toBe('μανιφεστο|7|2020');
  });
  test('brochure without publisher and year', () => {
    expect(buildMatchKey('brochure', { title: 'Μανιφέστο' })).toBe('μανιφεστο||');
  });
  test('unknown kind throws', () => {
    expect(() => buildMatchKey('book', {})).toThrow('Unknown match key kind: book');
  });
});
describe('buildMatchKey for magazines and issues', () => {
  test('magazine: title + qualifier, accent-insensitive', () => {
    expect(buildMatchKey('magazine', { title: 'Κοινωνικός Αναρχισμός', qualifier: null }))
      .toBe(buildMatchKey('magazine', { title: 'ΚΟΙΝΩΝΙΚΟΣ ΑΝΑΡΧΙΣΜΟΣ' }));
    expect(buildMatchKey('magazine', { title: 'Αναρχία', qualifier: 'Θεσσαλονίκη' }))
      .not.toBe(buildMatchKey('magazine', { title: 'Αναρχία' }));
  });

  test.each([['5'], ['05'], ['τεύχ. 5'], ['Τεύχος 5'], ['Νο 5'], ['no. 5'], [' 5 ']])(
    'issue number %s equals 5 (Review Focus 1)', (number) => {
      expect(buildMatchKey('issue', { magazineId: 3, issueNumber: number }))
        .toBe(buildMatchKey('issue', { magazineId: 3, issueNumber: '5' }));
    }
  );

  test('double issue: spacing does not matter, different from single issue', () => {
    expect(buildMatchKey('issue', { magazineId: 3, issueNumber: '12 - 13' }))
      .toBe(buildMatchKey('issue', { magazineId: 3, issueNumber: '12-13' }));
    expect(buildMatchKey('issue', { magazineId: 3, issueNumber: '12-13' }))
      .not.toBe(buildMatchKey('issue', { magazineId: 3, issueNumber: '12' }));
  });

  test('10 is not 1 (leading zeros only)', () => {
    expect(buildMatchKey('issue', { magazineId: 3, issueNumber: '10' }))
      .not.toBe(buildMatchKey('issue', { magazineId: 3, issueNumber: '1' }));
  });

  test('without a number the period decides; same number in another magazine is different', () => {
    expect(buildMatchKey('issue', { magazineId: 3, period: 'Άνοιξη 2020' }))
      .toBe(buildMatchKey('issue', { magazineId: 3, issueNumber: '', period: 'ΑΝΟΙΞΗ 2020' }));
    expect(buildMatchKey('issue', { magazineId: 3, issueNumber: '5' }))
      .not.toBe(buildMatchKey('issue', { magazineId: 4, issueNumber: '5' }));
  });
});

describe('issue numbers written without a space or with symbols (2γ minor M-5)', () => {
  test.each([['τεύχος5'], ['Νο5'], ['No5'], ['Nº 5'], ['N° 5'], ['Τ. 5'], ['τ.5']])('%s equals 5', (number) => {
    expect(buildMatchKey('issue', { magazineId: 3, issueNumber: number }))
      .toBe(buildMatchKey('issue', { magazineId: 3, issueNumber: '5' }));
  });

  test('a word that only starts like a prefix is kept', () => {
    expect(buildMatchKey('issue', { magazineId: 3, issueNumber: 'Νοέμβριος' }))
      .not.toBe(buildMatchKey('issue', { magazineId: 3, issueNumber: 'έμβριος' }));
  });
});
