import { ExpoConfig, ConfigContext } from "expo/config";
import * as path from "path";
import * as fs from "fs";

interface VariantConfig {
  displayName: string;
  iosBundleIdentifier: string;
  androidPackage: string;
  scheme: string;
  splashBackgroundColor: string;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const appVariant = process.env.APP_VARIANT ?? "production";
  const developmentTeam = process.env.APP_DEVELOPMENT_TEAM;
  const easProjectId =
    (config.extra as Record<string, any>)?.eas?.projectId ??
    process.env.EXPO_PROJECT_ID;
  const enablePush = process.env.ENABLE_PUSH_NOTIFICATIONS === "1";

  // Load variant-specific config
  const variantDir = path.join(__dirname, "variants", appVariant);
  const variantConfigPath = path.join(variantDir, "config.json");

  if (!fs.existsSync(variantConfigPath)) {
    throw new Error(
      `Missing variant config: ${variantConfigPath}\n` +
      `APP_VARIANT="${appVariant}" — expected a config.json in variants/${appVariant}/`
    );
  }

  const variant: VariantConfig = JSON.parse(
    fs.readFileSync(variantConfigPath, "utf8")
  );

  return {
    // Keep name constant — Xcode project/target/scheme stays "OpenVide"
    // (withNmsshFork hardcodes target 'OpenVide' in Podfile patching)
    owner: config.owner,
    name: config.name!,
    slug: config.slug!,
    version: "0.1.0",
    orientation: "portrait",
    icon: `./variants/${appVariant}/icon.png`,
    scheme: variant.scheme,
    userInterfaceStyle: "automatic",
    splash: {
      image: `./variants/${appVariant}/splash.png`,
      backgroundColor: variant.splashBackgroundColor,
      resizeMode: "contain",
    },
    assetBundlePatterns: ["**/*"],
    extra: {
      appVariant,
      eas: {
        projectId: easProjectId,
      },
    },
    updates: {
      url: `https://u.expo.dev/${easProjectId}`,
      fallbackToCacheTimeout: 0,
    },
    runtimeVersion: {
      policy: "appVersion" as const,
    },
    plugins: [
      [
        "expo-splash-screen",
        {
          image: `./variants/${appVariant}/splash.png`,
          imageWidth: 290,
          backgroundColor: variant.splashBackgroundColor,
        },
      ],
      [
        "expo-notifications",
        {
          color: "#0b1220",
        },
      ],
      "./plugins/withNmsshFork",
      "./plugins/withExcludeBouncyCastle",
      "./plugins/withGradleMemory",
      ...(enablePush ? [] : ["./plugins/withLocalNotificationsOnly"]),
      ["./plugins/withDevelopmentTeam", { teamId: developmentTeam }],
      ["./plugins/withAppDisplayName", { displayName: variant.displayName }],
      [
        "@jamsch/expo-speech-recognition",
        {
          microphonePermission:
            "Allow $(PRODUCT_NAME) to use the microphone for voice input",
        },
      ],
      "expo-secure-store",
      "expo-updates",
      [
        "expo-camera",
        {
          cameraPermission:
            "Allow $(PRODUCT_NAME) to use the camera to scan QR codes for host setup.",
        },
      ],
      [
        "expo-local-authentication",
        {
          faceIDPermission:
            "Allow $(PRODUCT_NAME) to use Face ID to unlock the app.",
        },
      ],
    ],
    ios: {
      supportsTablet: true,
      bundleIdentifier: variant.iosBundleIdentifier,
      infoPlist: {
        CFBundleDisplayName: variant.displayName,
        NSLocalNetworkUsageDescription:
          "This app connects to SSH servers on your local network to manage remote development tools.",
        NSBonjourServices: ["_ssh._tcp"],
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: `./variants/${appVariant}/icon.png`,
        backgroundColor: "#0b1220",
      },
      package: variant.androidPackage,
      ...(fs.existsSync(path.join(__dirname, "google-services.json"))
        ? { googleServicesFile: "./google-services.json" }
        : {}),
      softwareKeyboardLayoutMode: "resize",
    },
  };
};
