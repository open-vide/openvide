/**
 * Expo config plugin that fixes Android dependency conflicts from
 * react-native-ssh-sftp and its transitive dependencies:
 *
 * 1. Excludes legacy bcprov-jdk15on (conflicts with bcprov-jdk15to18 from Android tooling)
 * 2. Excludes duplicate META-INF resources from jsch / jspecify
 */
const { withAppBuildGradle } = require("expo/config-plugins");

const MARKER = "// [withExcludeBouncyCastle]";

function withExcludeBouncyCastle(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.contents.includes(MARKER)) {
      return mod;
    }

    const snippet = `
${MARKER}
configurations.all {
    exclude group: 'org.bouncycastle', module: 'bcprov-jdk15on'
}
`;

    // Insert before the `dependencies {` block
    mod.modResults.contents = mod.modResults.contents.replace(
      /^dependencies\s*\{/m,
      snippet + "\ndependencies {"
    );

    // Add META-INF exclusions inside the existing packagingOptions block
    if (!mod.modResults.contents.includes("META-INF/versions/9/OSGI-INF/MANIFEST.MF")) {
      mod.modResults.contents = mod.modResults.contents.replace(
        /packagingOptions\s*\{/,
        `packagingOptions {
        resources {
            excludes += 'META-INF/versions/9/OSGI-INF/MANIFEST.MF'
        }`
      );
    }

    return mod;
  });
}

module.exports = withExcludeBouncyCastle;
