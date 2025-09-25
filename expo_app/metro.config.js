const { getDefaultConfig } = require('@expo/metro-config');

const config = getDefaultConfig(__dirname);

// Exclude test files from being bundled by Metro during app runs
config.resolver = config.resolver || {};
config.resolver.blockList = new RegExp(
  [
    '.*\\.test\\.[jt]sx?$',
    '__tests__\/.*',
  ].join('|')
);

module.exports = config;


