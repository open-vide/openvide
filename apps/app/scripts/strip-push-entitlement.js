#!/usr/bin/env node
/**
 * Post-prebuild script that removes the aps-environment entitlement
 * from generated iOS entitlements files. This allows expo-notifications
 * to work for local-only notifications on personal (free) Apple Developer
 * accounts which don't support Push Notifications.
 *
 * Run automatically via `yarn prebuild` (see package.json scripts).
 */
const fs = require("fs");
const path = require("path");

const iosDir = path.join(__dirname, "..", "ios");

function findEntitlementsFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "Pods" && entry.name !== "build") {
      results.push(...findEntitlementsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".entitlements")) {
      results.push(fullPath);
    }
  }
  return results;
}

const files = findEntitlementsFiles(iosDir);

if (files.length === 0) {
  console.log("[strip-push-entitlement] No .entitlements files found in ios/");
  process.exit(0);
}

for (const filePath of files) {
  let content = fs.readFileSync(filePath, "utf8");

  if (!content.includes("aps-environment")) {
    console.log(`[strip-push-entitlement] ${path.relative(iosDir, filePath)}: no aps-environment found, skipping`);
    continue;
  }

  // Remove the aps-environment key-value pair
  content = content.replace(
    /\s*<key>aps-environment<\/key>\s*<string>[^<]*<\/string>/g,
    ""
  );

  fs.writeFileSync(filePath, content, "utf8");
  console.log(`[strip-push-entitlement] ${path.relative(iosDir, filePath)}: removed aps-environment entitlement`);
}
