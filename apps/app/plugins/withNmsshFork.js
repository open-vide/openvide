/**
 * Expo config plugin that patches the Podfile to use aanah0's NMSSH fork
 * with ecdh-sha2-nistp256 key exchange support (fixes SSH on physical devices)
 * and excludes arm64 for simulator builds (NMSSH ships device-only libcrypto.a).
 *
 * This survives `expo prebuild --clean` because it's registered as a plugin.
 */
const { withDangerousMod, withXcodeProject } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

function withNmsshFork(config) {
  // 1. Patch Podfile: add NMSSH fork + exclude arm64 on all pod targets for simulator
  config = withDangerousMod(config, [
    "ios",
    async (mod) => {
      const podfilePath = path.join(mod.modRequest.projectRoot, "ios", "Podfile");
      if (!fs.existsSync(podfilePath)) {
        return mod;
      }

      let podfile = fs.readFileSync(podfilePath, "utf8");

      // Add NMSSH fork pod reference after target line
      const nmsshPodLine = "  # Use aanah0's NMSSH fork with ecdh-sha2-nistp256 key exchange support (fixes physical device SSH)\n  pod 'NMSSH', :git => 'https://github.com/aanah0/NMSSH.git'\n";

      if (!podfile.includes("aanah0/NMSSH")) {
        podfile = podfile.replace(
          /(target ['"]OpenVide['"] do\n)/,
          `$1\n${nmsshPodLine}\n`
        );
      }

      // Add arm64 exclusion for simulator builds in post_install.
      // NMSSH ships libcrypto.a for device only (no arm64 simulator slice).
      // All pod targets must exclude arm64 on simulator so the linker can resolve
      // NMSSH symbols from RNSSHClient and the main app target.
      const arm64Block = `
    # NMSSH ships libcrypto.a built for device only — exclude arm64 on simulator for all targets
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['EXCLUDED_ARCHS[sdk=iphonesimulator*]'] = 'arm64'
      end
    end`;

      if (!podfile.includes("EXCLUDED_ARCHS[sdk=iphonesimulator*]")) {
        // Insert before the final `end` of post_install block
        const lastTwoEnds = /(\s+end\s*\nend\s*)$/;
        podfile = podfile.replace(lastTwoEnds, `${arm64Block}\n$1`);
      }

      fs.writeFileSync(podfilePath, podfile, "utf8");
      console.log("[withNmsshFork] Patched Podfile with NMSSH fork + arm64 exclusion");
      return mod;
    },
  ]);

  // 2. Patch Xcode project: exclude arm64 on the main app target for simulator
  config = withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const buildConfigs = project.pbxXCBuildConfigurationSection();

    for (const key in buildConfigs) {
      const config = buildConfigs[key];
      if (typeof config === "string") continue;
      const settings = config.buildSettings;
      if (!settings) continue;

      // Set EXCLUDED_ARCHS for simulator on all build configurations
      settings['"EXCLUDED_ARCHS[sdk=iphonesimulator*]"'] = 'arm64';
    }

    console.log("[withNmsshFork] Patched Xcode project with arm64 simulator exclusion");
    return mod;
  });

  return config;
}

module.exports = withNmsshFork;
