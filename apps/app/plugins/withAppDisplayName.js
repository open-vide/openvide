/**
 * Expo config plugin that sets the Android launcher display name.
 *
 * Since `name` in app.config.ts stays constant ("Open Vide") to preserve
 * the Xcode project/target name, this plugin patches Android's
 * @string/app_name to show the variant-specific display name (e.g. "OV Dev").
 *
 * iOS doesn't need this — CFBundleDisplayName in infoPlist handles it.
 */
const { withStringsXml } = require("expo/config-plugins");

function withAppDisplayName(config, { displayName }) {
  if (!displayName) return config;

  return withStringsXml(config, (mod) => {
    const strings = mod.modResults.resources.string ?? [];

    const appNameEntry = strings.find((s) => s.$.name === "app_name");
    if (appNameEntry) {
      appNameEntry._ = displayName;
    }

    return mod;
  });
}

module.exports = withAppDisplayName;
