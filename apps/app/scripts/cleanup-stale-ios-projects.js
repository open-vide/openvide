const fs = require("fs");
const path = require("path");

const iosDir = path.resolve(__dirname, "../ios");
const canonicalProject = path.join(iosDir, "OpenVide.xcodeproj");
const staleEntries = [
  path.join(iosDir, "RemoteDevToolV2.xcodeproj"),
  path.join(iosDir, "RemoteDevToolV2.xcworkspace"),
];

if (!fs.existsSync(canonicalProject)) {
  process.exit(0);
}

for (const entry of staleEntries) {
  if (!fs.existsSync(entry)) {
    continue;
  }
  fs.rmSync(entry, { recursive: true, force: true });
  console.log(`[ios-cleanup] removed stale iOS artifact: ${path.basename(entry)}`);
}
