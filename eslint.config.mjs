// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      import: importPlugin,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      'import/no-cycle': 'error',
      'import/no-self-import': 'error',
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: './tsconfig.json',
        },
      },
    },
  },
  {
    // Jest's asymmetric matchers (expect.any, expect.stringMatching, ...) are
    // typed `any` by design; type-checked lint rules can't see through them.
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', '**/*.integration-spec.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  {
    // BE-SPEC §13 / CLAUDE.md invariant #10: no scheduler, anywhere - no
    // bare setInterval in a module. Import-based scheduler packages
    // (@nestjs/schedule, node-cron, ...) are caught by dependency-cruiser's
    // no-scheduler-imports rule instead; setInterval is a global call, not
    // an import, so it needs its own rule here. Scoped to src/ only - test
    // helpers (e.g. a polling waitUntil()) aren't "a module".
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'setInterval',
          message:
            'No scheduler, anywhere (CLAUDE.md invariant #10). Everything Swoop-related is ' +
            'dispatcher-triggered (ADR-012); the outbox relay is event-driven via LISTEN/NOTIFY.',
        },
      ],
    },
  },
);
