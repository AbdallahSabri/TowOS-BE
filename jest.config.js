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
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/**/*.e2e-spec.ts'],
  setupFiles: ['<rootDir>/test/jest.setup.ts'],
  rootDir: '.',
};
