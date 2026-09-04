export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    // nestjs-pino can't load under Jest's ESM sandbox - see test/mocks/nestjs-pino.ts.
    '^nestjs-pino$': '<rootDir>/test/mocks/nestjs-pino.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true }],
  },
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/src/**/*.spec.ts',
    '<rootDir>/test/**/*.spec.ts',
    '<rootDir>/test/**/*.e2e-spec.ts',
    '<rootDir>/test/**/*.integration-spec.ts',
  ],
  setupFiles: ['<rootDir>/test/jest.setup.ts'],
  globalSetup: '<rootDir>/test/global-setup.js',
  // Serial, not parallel: most of this suite hits the same small
  // docker-compose.test.yml Postgres/Redis/RabbitMQ, several tests spawn
  // their own child processes and full `tsc` compiles, and one hardcodes
  // a port. Parallel workers contend for all of that at once - confirmed
  // directly: the full suite is both flaky (a real query timing out under
  // load, port-wait timeouts) and *slower* in parallel (~29s) than serial
  // (~8s) on this machine.
  maxWorkers: 1,
  rootDir: '.',
};
