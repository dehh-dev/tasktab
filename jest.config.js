'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js', 'infra/**/*.js'],
  clearMocks: true,
  testTimeout: 15000,
};
