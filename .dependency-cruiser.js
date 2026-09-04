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
      to: {
        dependencyTypes: ['core'],
        path: [
          '^v8/tools/codemap$',
          '^v8/tools/consarray$',
          '^v8/tools/csvparser$',
          '^v8/tools/logreader$',
          '^v8/tools/profile_view$',
          '^v8/tools/profile$',
          '^v8/tools/SourceMap$',
          '^v8/tools/splaytree$',
          '^v8/tools/tickprocessor-driver$',
          '^v8/tools/tickprocessor$',
          '^node-inspect/lib/_inspect$',
          '^node-inspect/lib/internal/inspect_client$',
          '^node-inspect/lib/internal/inspect_repl$',
          // async_hooks (AsyncLocalStorage) is not actually deprecated -
          // dependency-cruiser's own init template lists it, but it's the
          // standard, current API for request-scoped context (used by
          // common/tenant/tenant-context.storage.ts).
          '^punycode$',
          '^domain$',
          '^constants$',
          '^sys$',
          '^_linklist$',
          '^_stream_wrap$',
        ],
      },
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
    // --- BE-SPEC §13: cut-scope guards ---
    {
      name: 'no-notification-sdks',
      severity: 'error',
      comment:
        'No SMS/email/push SDK (BE-SPEC §13 / §8.5): TowOS has no notifications in this phase. ' +
        'If one of these is a genuine dependency of something else, it needs a scope conversation, ' +
        'not a workaround here.',
      from: { path: '^src/' },
      to: {
        path: [
          '^twilio',
          '^nexmo',
          '^@vonage/',
          '^plivo',
          '^messagebird',
          '^nodemailer',
          '^@sendgrid/',
          '^mailgun',
          '^postmark',
          '^@aws-sdk/client-ses',
          '^@aws-sdk/client-sns',
          '^firebase-admin',
          '^web-push',
          '^onesignal',
          '^expo-server-sdk',
          '^apn$',
          '^node-pushnotifications',
        ],
      },
    },
    {
      name: 'no-scheduler-imports',
      severity: 'error',
      comment:
        'No scheduler, anywhere (CLAUDE.md invariant #10 / BE-SPEC §13): everything Swoop-related ' +
        'is dispatcher-triggered (ADR-012). Bare setInterval calls are caught separately by ' +
        "eslint's no-restricted-globals rule (setInterval isn't an import).",
      from: { path: '^src/' },
      to: { path: ['^@nestjs/schedule', '^node-cron', '^node-schedule', '^cron$', '^agenda$'] },
    },
    {
      name: 'common-tenant-internals-are-private',
      severity: 'error',
      comment:
        'Tenant context is set in exactly one place (CLAUDE.md invariant 2): common/tenant/. ' +
        'Other code may inject TenantService (tenant.service.ts) or import TenantModule ' +
        '(tenant.module.ts) - that is the sanctioned way to run tenant-scoped queries - but may ' +
        'not reach into tenant-context.storage.ts, tenant-id.ts, or assert-no-bypass-rls.ts ' +
        'directly, which would make it possible to reimplement or bypass the SET LOCAL wrapper.',
      from: {
        path: '^src/(modules|common)/',
        pathNot: '^src/common/tenant/',
      },
      to: {
        path: '^src/common/tenant/(?!tenant\\.service\\.ts$|tenant\\.module\\.ts$).+',
      },
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
