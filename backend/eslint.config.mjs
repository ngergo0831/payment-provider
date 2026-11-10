import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'eslint.config.mjs', 'jest.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Fakes and adapters implement async ports without awaiting anything; `async` still turns a throw into a rejection.
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    // Application and payments-domain code depend on ports (abstract classes); only infrastructure knows the database
    // and token libraries. onboarding/domain is deliberately not listed: Company and User are decorated entities.
    files: ['src/**/application/**/*.ts', 'src/payments/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: ['typeorm', 'pg', '@nestjs/typeorm', '@nestjs/jwt', '@nestjs/passport', 'passport', 'passport-jwt', 'jsonwebtoken'] },
      ],
    },
  },
  {
    // HTTP response bodies (supertest) and Jest matchers are untyped by nature.
    files: ['test/**/*.ts', 'src/**/*.spec.ts', 'src/testing/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  prettier,
);
