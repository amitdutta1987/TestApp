module.exports = {
  root: true,
  extends: '@react-native',
  ignorePatterns: ['node_modules/', 'android/', 'coverage/', '*.config.js', 'jest.setup.js'],
  rules: {
    'react-native/no-inline-styles': 'off',
    'no-console': ['warn', {allow: ['warn', 'error']}],
    // `void somePromise()` is how this codebase marks a deliberately unawaited
    // promise in event handlers and effects.
    'no-void': 'off',
  },
  overrides: [
    {
      files: ['__tests__/**/*.ts', '__tests__/**/*.tsx', 'src/database/seed/**'],
      rules: {'no-console': 'off'},
    },
  ],
};
