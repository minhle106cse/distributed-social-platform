// @ts-check
import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  // Prettier owns formatting; turn off any stylistic ESLint rules that conflict.
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: {
        // Required in monorepos where multiple tsconfig candidates exist.
        // Tells the parser to root tsconfig lookups from this package's directory.
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // CQRS bus generics rely on `any` constraints; align with auth-service/core-api.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  // Build scripts are plain Node CommonJS, not library source: they legitimately use
  // `process`, `require`, `__dirname`. Without this the shared `eslint.configs.recommended`
  // (browser-ish default globals) flagged `process` as undefined in scripts/gen-proto.js —
  // 1 error that kept `npm run check` red repo-wide even when every service was clean
  // (found 2026-08-21 while driving the monorepo lint count from 261 to 0).
  {
    files: ['scripts/**/*.js', 'scripts/**/*.cjs'],
    languageOptions: {
      globals: { process: 'readonly', require: 'readonly', __dirname: 'readonly', module: 'writable' },
    },
  },

);
