/**
 * Expo config plugin that increases Gradle JVM memory limits and disables
 * lint for release builds to prevent OutOfMemoryError: Metaspace during
 * local production builds.
 *
 * Modifies gradle.properties (JVM args) and app/build.gradle (lint config).
 */
const {
  withGradleProperties,
  withAppBuildGradle,
} = require("expo/config-plugins");

function withGradleMemory(config) {
  // 1. Increase JVM heap + metaspace in gradle.properties
  config = withGradleProperties(config, (mod) => {
    const props = mod.modResults;

    // Remove existing org.gradle.jvmargs entry if present
    const idx = props.findIndex(
      (p) => p.type === "property" && p.key === "org.gradle.jvmargs"
    );
    if (idx !== -1) {
      props.splice(idx, 1);
    }

    props.push({
      type: "property",
      key: "org.gradle.jvmargs",
      value: "-Xmx4g -XX:MaxMetaspaceSize=1g -XX:+HeapDumpOnOutOfMemoryError",
    });

    return mod;
  });

  // 2. Disable lint abort on error in app/build.gradle
  config = withAppBuildGradle(config, (mod) => {
    const MARKER = "// [withGradleMemory]";
    if (mod.modResults.contents.includes(MARKER)) {
      return mod;
    }

    const lintBlock = `
${MARKER}
android.lintOptions {
    checkReleaseBuilds false
    abortOnError false
}
`;

    // Append after the last closing brace
    mod.modResults.contents += lintBlock;

    return mod;
  });

  return config;
}

module.exports = withGradleMemory;
