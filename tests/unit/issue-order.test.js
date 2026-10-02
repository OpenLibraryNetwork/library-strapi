'use strict';

const { issueOrderOf } = require('../../src/utils/text-keys');

test.each([
  ['5', 5], ['05', 5], ['τχ. 7', 7], ['Τεύχος 7', 7], ['Νο 7', 7], ['Nº 7', 7],
  ['12-13', 12], ['12 - 13', 12], ['Ειδικό τεύχος', 0], ['', 0], [null, 0], [undefined, 0],
])('issueOrderOf(%j) → %i', (input, expected) => {
  expect(issueOrderOf(input)).toBe(expected);
});
