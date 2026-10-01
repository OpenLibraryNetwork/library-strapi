'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

function runAsMerge(fn) {
  return storage.run({ merging: true }, fn);
}

function isMerging() {
  return storage.getStore()?.merging === true;
}

module.exports = { runAsMerge, isMerging };
