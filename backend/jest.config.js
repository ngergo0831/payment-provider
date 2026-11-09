// Nest 12 ships ESM-only packages, so tests run in Jest's native ESM mode
// (`node --experimental-vm-modules`, see the "test" script). Production uses `nest build`.
module.exports = {
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.jest.json', useESM: true, diagnostics: false }],
  },
};
