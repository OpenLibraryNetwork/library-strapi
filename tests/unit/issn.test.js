'use strict';

const { normalizeIssn, issnFromEan, parseIssnCode } = require('../../src/utils/issn');

describe('normalizeIssn', () => {
  test.each([
    ['2241-5580', '2241-5580'],
    ['22415580', '2241-5580'],
    [' 2241 5580 ', '2241-5580'],
    ['1108-2402', '1108-2402'],
    ['0000-006X', '0000-006X'],
    ['0000-006x', '0000-006X'], // Review Focus 3: lowercase x
  ])('%s → %s', (raw, expected) => { expect(normalizeIssn(raw)).toBe(expected); });

  test.each([['2241-5581'], ['2241-558'], ['abcd-efgh'], [''], [null], [undefined]])('invalid: %s', (raw) => {
    expect(normalizeIssn(raw)).toBeNull();
  });
});

describe('issnFromEan', () => {
  test('EAN-13 of a serial', () => { expect(issnFromEan('9772241558008')).toBe('2241-5580'); });
  test('other serial', () => { expect(issnFromEan('9771108240001')).toBe('1108-2402'); });
  test('wrong EAN check digit', () => { expect(issnFromEan('9772241558009')).toBeNull(); });
  test('not a serial (ISBN barcode)', () => { expect(issnFromEan('9789602116524')).toBeNull(); });
});

describe('parseIssnCode', () => {
  test('ISSN', () => { expect(parseIssnCode('2241-5580')).toBe('2241-5580'); });
  test('EAN-13', () => { expect(parseIssnCode('9772241558008')).toBe('2241-5580'); });
  test('EAN with 2-digit add-on sent together (Review Focus 3)', () => {
    expect(parseIssnCode('977224155800805')).toBe('2241-5580');
  });
  test('EAN with 5-digit add-on sent together (Review Focus 3)', () => {
    expect(parseIssnCode('977224155800812345')).toBe('2241-5580');
  });
  test('ISBN barcode is rejected', () => { expect(parseIssnCode('9789602116524')).toBeNull(); });
  test('text is rejected', () => { expect(parseIssnCode('Κοινωνικός Αναρχισμός')).toBeNull(); });
});
