/**
 * Expo config plugin that removes the Push Notifications capability
 * added by expo-notifications. This allows local notifications to work
 * on personal (free) Apple Developer accounts which don't support push.
 *
 * Strategy: expo-notifications auto-links and adds aps-environment via
 * withEntitlementsPlist. Due to LIFO modifier ordering, user plugins run
 * before auto-linked ones. So instead we use a postprebuild script
 * (scripts/strip-push-entitlement.js) to clean the generated file.
 *
 * This config plugin still handles removing UIBackgroundModes remote-notification.
 */
const { withInfoPlist } = require("expo/config-plugins");

function withLocalNotificationsOnly(config) {
  // Remove remote-notification from UIBackgroundModes
  config = withInfoPlist(config, (mod) => {
    const bgModes = mod.modResults.UIBackgroundModes;
    if (Array.isArray(bgModes)) {
      mod.modResults.UIBackgroundModes = bgModes.filter(
        (mode) => mode !== "remote-notification"
      );
      if (mod.modResults.UIBackgroundModes.length === 0) {
        delete mod.modResults.UIBackgroundModes;
      }
    }
    return mod;
  });

  return config;
}

module.exports = withLocalNotificationsOnly;
