'use strict';

const globals = require('globals');
const prettier = require('eslint-config-prettier');
const react = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');

module.exports = [
  {
    ignores: ['node_modules/**', 'coverage/**', 'web/dist/**'],
  },
  // Backend: CommonJS rodando no Node.
  {
    files: ['**/*.js'],
    ignores: ['web/**'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'no-return-await': 'error',
    },
  },
  {
    files: ['tests/**/*.js', 'jest.setup.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
  // Frontend: ESM com JSX rodando no browser.
  {
    files: ['web/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // Sem essas duas o no-unused-vars acusa falsamente componentes e
      // variaveis usados apenas dentro do JSX.
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
    },
  },
  // vite.config.js roda no Node, mas como ESM.
  {
    files: ['web/vite.config.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  prettier,
];
