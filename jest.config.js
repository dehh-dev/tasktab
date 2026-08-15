'use strict';

module.exports = {
  testEnvironment: 'node',
  globalSetup: '<rootDir>/tests/global-setup.js',
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js', 'infra/**/*.js'],
  clearMocks: true,
  testTimeout: 15000,
};
