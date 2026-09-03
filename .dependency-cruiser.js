/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'warn',
      comment:
        'This dependency is part of a circular relationship. You might want to revise ' +
        'your solution (i.e. use dependency inversion, make sure the modules have a single responsibility).',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment:
        "This is an orphan module - it's likely not used (anymore?). Either use it or remove it.",
      from: {
        orphan: true,
        pathNot: [
          '(^|/)[.][^/]+[.](?:js|cjs|mjs|ts|cts|mts|json)$',
          '[.]d[.]ts$',
          '(^|/)tsconfig.*[.]json$',
          '(^|/)eslint[.]config[.](?:js|cjs|mjs)$',
          '^src/main[.]ts$',
          '^src/worker[.]ts$',
        ],
      },
      to: {},
    },
    {
      name: 'no-deprecated-core',
      severity: 'warn',
      comment: 'A module depends on a deprecated node core module.',
      from: {},
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'not-to-deprecated',
      severity: 'warn',
      comment: 'This module depends on a deprecated npm module.',
      from: {},
      to: { dependencyTypes: ['deprecated'] },
    },
    {
      name: 'no-non-package-json',
      severity: 'error',
      comment: "This module depends on an npm package not listed in package.json's dependencies.",
      from: {},
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment: 'This module depends on a module that cannot be resolved to disk.',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-duplicate-dep-types',
      severity: 'warn',
      comment: 'This module depends on an npm package declared more than once in package.json.',
      from: {},
      to: {
        moreThanOneDependencyType: true,
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'not-to-spec',
      severity: 'error',
      comment: 'Non-test code must not depend on a .spec/.test file.',
      from: {},
      to: { path: '[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$' },
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment:
        "This module depends on a devDependency. Move it to 'dependencies' if it ships to production.",
      from: {
        path: '^src',
        pathNot: '[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$',
      },
      to: {
        dependencyTypes: ['npm-dev'],
        dependencyTypesNot: ['type-only'],
        pathNot: ['node_modules/@types/'],
      },
    },

    // --- BE-SPEC §6: module boundary rule ---
    {
      name: 'no-cross-module-internals',
      severity: 'error',
      comment:
        'A module may import another module only through its exported service (index.ts barrel), ' +
        'never by reaching into another module\'s internal files. See CLAUDE.md invariant 7 and BE-SPEC §6.',
      from: {
        path: '^src/modules/([^/]+)/',
      },
      to: {
        path: '^src/modules/(?!$1/)[^/]+/(?!index\\.ts$).+',
      },
    },
    {
      name: 'no-module-reads-database-internals-directly',
      severity: 'error',
      comment:
        'No cross-module table reads (BE-SPEC §6): a module reaches the database only through ' +
        'its own repositories, never by importing another module\'s repository/entity files. ' +
        'Shared database plumbing lives in database/ and messaging/, which any module may import.',
      from: { path: '^src/modules/' },
      to: { path: '^src/database/migrations/' },
    },
    {
      name: 'common-tenant-is-the-only-tenant-context-writer',
      severity: 'error',
      comment:
        'Tenant context is set in exactly one place (CLAUDE.md invariant 2): common/tenant/. ' +
        'No other module may reimplement or bypass it by importing typeorm/pg session APIs directly ' +
        'outside common/tenant and database/.',
      from: {
        path: '^src/(modules|common)/',
        pathNot: '^src/common/tenant/',
      },
      to: {
        path: '^src/common/tenant/',
      },
      // informational placeholder: real enforcement of "don't SET LOCAL elsewhere" is a grep/test
      // concern (raw SQL string), not an import-graph concern. This rule only flags accidental
      // reimport of tenant internals from outside common/tenant, keeping the boundary visible.
    },
  ],
  options: {
    doNotFollow: {
      path: ['node_modules'],
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
    skipAnalysisNotInRules: true,
    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
  },
};
