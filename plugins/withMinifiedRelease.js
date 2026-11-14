/**
 * Turns R8 on for release builds.
 *
 * Expo's template sets `android.enableMinifyInReleaseBuilds` to false, which
 * ships tens of megabytes of unminified dex. React Native and
 * expo-modules-core carry their own consumer keep rules, and this app has no
 * other native code, so no extra rules are needed. The release workflow
 * installs the minified APK on an emulator and asserts the app renders, so a
 * missing rule fails the build rather than shipping.
 */
const { withGradleProperties } = require('expo/config-plugins');

const MINIFY_KEY = 'android.enableMinifyInReleaseBuilds';

module.exports = function withMinifiedRelease(config) {
  return withGradleProperties(config, (cfg) => {
    const existing = cfg.modResults.find((item) => item.type === 'property' && item.key === MINIFY_KEY);
    if (existing) {
      existing.value = 'true';
      return cfg;
    }
    cfg.modResults.push({ type: 'property', key: MINIFY_KEY, value: 'true' });
    return cfg;
  });
};
