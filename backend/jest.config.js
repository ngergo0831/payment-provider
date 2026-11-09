// Nest 12 ships ESM-only packages, so tests run in Jest's native ESM mode
// (`node --experimental-vm-modules`, see the "test" script). Production uses `nest build`.
module.exports = {
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  // Decorators (class-validator, Nest DI) need this polyfill before any decorated class loads.
  // In the running app Nest imports it first; a unit test that imports a decorated file alone must do it itself.
  setupFiles: ['reflect-metadata'],
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.jest.json', useESM: true, diagnostics: false }],
  },
};
