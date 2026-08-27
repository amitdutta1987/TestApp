const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    /**
     * server/ is the Cloudflare Worker, which has its own node_modules and is
     * never imported by the app. Metro would otherwise crawl and watch it, and
     * its duplicate copy of typescript trips the haste module collision check.
     */
    blockList: /[\\/]server[\\/].*/,
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
