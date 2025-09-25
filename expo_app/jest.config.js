module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: [
    '<rootDir>/jest.setup.js',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(jest-)?react-native|@react-native|@react-navigation|expo(|-[a-z]+)*|@expo(|-[a-z]+)*/.*|react-clone-referenced-element|react-native-svg)'
  ],
};


