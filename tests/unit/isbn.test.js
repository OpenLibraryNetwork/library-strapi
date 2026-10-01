'use strict';

const { normalizeIsbn, isValidIsbn10, isValidIsbn13, toIsbn13 } = require('../../src/utils/isbn');

describe('isValidIsbn13', () => {
  test('valid', () => { expect(isValidIsbn13('9789602116524')).toBe(true); });
  test('wrong check digit', () => { expect(isValidIsbn13('9789602116525')).toBe(false); });
  test('wrong length', () => { expect(isValidIsbn13('978960211652')).toBe(false); });
});

describe('isValidIsbn10', () => {
  test('valid with digit check', () => { expect(isValidIsbn10('9602116528')).toBe(true); });
  test('valid with X check digit', () => { expect(isValidIsbn10('080442957X')).toBe(true); });
  test('invalid', () => { expect(isValidIsbn10('9602116520')).toBe(false); });
});

describe('toIsbn13', () => {
  test('converts ISBN-10 to ISBN-13', () => {
    expect(toIsbn13('9602116528')).toBe('9789602116524');
  });
  test('converts ISBN-10 ending in X', () => {
    expect(toIsbn13('080442957X')).toBe('9780804429573');
  });
});

describe('normalizeIsbn (Review Focus 4)', () => {
  test('strips dashes', () => {
    expect(normalizeIsbn('978-960-211-652-4')).toBe('9789602116524');
  });
  test('strips spaces', () => {
    expect(normalizeIsbn(' 978 960 211 652 4 ')).toBe('9789602116524');
  });
  test('ISBN-10 becomes ISBN-13', () => {
    expect(normalizeIsbn('960-211-652-8')).toBe('9789602116524');
  });
  test('lowercase x accepted', () => {
    expect(normalizeIsbn('0-8044-2957-x')).toBe('9780804429573');
  });
  test('invalid returns null', () => {
    expect(normalizeIsbn('978-960-211-652-5')).toBeNull();
  });
  test('garbage returns null', () => {
    expect(normalizeIsbn('abc')).toBeNull();
    expect(normalizeIsbn('')).toBeNull();
    expect(normalizeIsbn(null)).toBeNull();
  });
});

describe('toIsbn10', () => {
  const { toIsbn10 } = require('../../src/utils/isbn');
  test('converts a 978 ISBN-13 to ISBN-10', () => {
    expect(toIsbn10('9780132350884')).toBe('0132350882');
  });
  test('uses X as check digit when needed', () => {
    expect(toIsbn10('9780804429573')).toBe('080442957X');
  });
  test('979 ISBNs have no ISBN-10 form', () => {
    expect(toIsbn10('9791032305690')).toBeNull();
  });
});
