'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  testTimeout: 60000,
  modulePathIgnorePatterns: ['<rootDir>/.tmp/', '<rootDir>/dist/', '<rootDir>/build/'],
};
