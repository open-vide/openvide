/**
 * Expo config plugin that sets the DEVELOPMENT_TEAM build setting
 * from the APP_DEVELOPMENT_TEAM env var. This allows each developer
 * to use their own Apple Developer Team ID.
 */
const { withXcodeProject } = require("expo/config-plugins");

function withDevelopmentTeam(config, { teamId }) {
  if (!teamId) return config;

  return withXcodeProject(config, (mod) => {
    const project = mod.modResults;

    // Enable automatic signing in target attributes
    const firstTarget = project.getFirstTarget();
    if (firstTarget) {
      const targetId = firstTarget.uuid;
      const pbxProject = project.pbxProjectSection();
      for (const projKey in pbxProject) {
        const proj = pbxProject[projKey];
        if (typeof proj === "string") continue;
        if (!proj.attributes) proj.attributes = {};
        if (!proj.attributes.TargetAttributes) proj.attributes.TargetAttributes = {};
        if (!proj.attributes.TargetAttributes[targetId]) proj.attributes.TargetAttributes[targetId] = {};
        proj.attributes.TargetAttributes[targetId].DevelopmentTeam = teamId;
        proj.attributes.TargetAttributes[targetId].ProvisioningStyle = "Automatic";
      }
    }

    const buildConfigs = project.pbxXCBuildConfigurationSection();

    for (const key in buildConfigs) {
      const cfg = buildConfigs[key];
      if (typeof cfg === "string") continue;
      const settings = cfg.buildSettings;
      if (!settings) continue;

      if (settings.PRODUCT_BUNDLE_IDENTIFIER) {
        settings.DEVELOPMENT_TEAM = teamId;
        settings.CODE_SIGN_STYLE = "Automatic";
      }
    }

    console.log(`[withDevelopmentTeam] Set DEVELOPMENT_TEAM to ${teamId} with automatic signing`);
    return mod;
  });
}

module.exports = withDevelopmentTeam;
