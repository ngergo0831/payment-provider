// Nest 12 ships ESM-only packages, so tests run in Jest's native ESM mode
// (`node --experimental-vm-modules`, see the scripts in package.json). Production uses `nest build`.
//
// Two kinds of tests, run separately:
//   unit  (src/**/*.spec.ts)        fast, need NO infrastructure         npm test
//   e2e   (test/**/*.e2e-spec.ts)   whole app + a real PostgreSQL        npm run test:e2e   (docker compose up -d first)
const base = {
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  // Decorators (class-validator, Nest DI) need this polyfill before any decorated class loads.
  // In the running app Nest imports it first; a test that imports a decorated file alone must do it itself.
  setupFiles: ['reflect-metadata'],
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.jest.json', useESM: true, diagnostics: false }],
  },
};

module.exports = {
  projects: [
    { ...base, displayName: 'unit', rootDir: 'src', testRegex: '.*\\.spec\\.ts$' },
    { ...base, displayName: 'e2e', rootDir: 'test', testRegex: '.*\\.e2e-spec\\.ts$', testTimeout: 60000 },
  ],
};
