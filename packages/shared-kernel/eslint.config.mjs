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
    rules: {
      // CQRS bus generics rely on `any` constraints; align with auth-service/core-api.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
