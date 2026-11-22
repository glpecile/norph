// Resolves `norph` to the package source one folder up, and every other
// module from this app only, so React and Reanimated load once.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const root = path.resolve(__dirname, '..');
const config = getDefaultConfig(__dirname);
config.watchFolders = [root];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
config.resolver.disableHierarchicalLookup = true;
config.resolver.extraNodeModules = { norph: root };
config.resolver.blockList = [new RegExp(`^${path.join(root, 'node_modules')}/.*`)];
module.exports = config;
