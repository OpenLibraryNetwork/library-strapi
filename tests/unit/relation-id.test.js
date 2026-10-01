'use strict';

const { extractRelationId } = require('../../src/utils/relation-id');

test.each([
  [undefined, { changed: false, id: null }],
  [null, { changed: true, id: null }],
  [5, { changed: true, id: 5 }],
  ['5', { changed: true, id: 5 }],
  [{ id: 5 }, { changed: true, id: 5 }],
  [[5], { changed: true, id: 5 }],
  [[{ id: 5 }], { changed: true, id: 5 }],
  [[], { changed: true, id: null }],
  [{ set: [{ id: 5 }] }, { changed: true, id: 5 }],
  [{ set: [] }, { changed: true, id: null }],
  [{ connect: [{ id: 7 }], disconnect: [{ id: 5 }] }, { changed: true, id: 7 }],
  [{ connect: [], disconnect: [{ id: 5 }] }, { changed: true, id: null }],
  [{ connect: [], disconnect: [] }, { changed: false, id: null }],
])('extractRelationId(%j)', (input, expected) => {
  expect(extractRelationId(input)).toEqual(expected);
});

const { isToManyChange } = require('../../src/utils/relation-id');

test.each([
  [undefined, false],
  [null, true],
  [[], true],
  [[3], true],
  [{ set: [] }, true],
  [{ connect: [], disconnect: [] }, false],
  [{ connect: [{ id: 3 }], disconnect: [] }, true],
  [{ connect: [], disconnect: [{ id: 3 }] }, true],
])('isToManyChange(%j) → %s', (input, expected) => {
  expect(isToManyChange(input)).toBe(expected);
});
