import tseslint from 'typescript-eslint';
import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';

export default [
  { ignores: ['dist/'] },

  // Base recommended configs (global)
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,

  // src rules
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-console': 'warn',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/utils/logger.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // test rules
  {
    files: ['test/**/*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
