import { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  const iosBundleIdentifier = process.env.APP_IOS_BUNDLE_IDENTIFIER;
  const androidPackage = process.env.APP_ANDROID_PACKAGE;
  const developmentTeam = process.env.APP_DEVELOPMENT_TEAM;

  if (!iosBundleIdentifier || !androidPackage) {
    throw new Error(
      "Missing required env vars: APP_IOS_BUNDLE_IDENTIFIER, APP_ANDROID_PACKAGE. " +
      "Copy .env.example to .env and fill in your values."
    );
  }

  return {
    name: "Open Vide",
    slug: "open-vide",
    version: "0.1.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "automatic",
    splash: {
      image: "./assets/splash.png",
      backgroundColor: "#1E1E1E",
      resizeMode: "contain",
    },
    assetBundlePatterns: ["**/*"],
    plugins: [
      "expo-splash-screen",
      [
        "expo-notifications",
        {
          color: "#0b1220",
        },
      ],
      "./plugins/withLocalNotificationsOnly",
      "./plugins/withNmsshFork",
      ["./plugins/withDevelopmentTeam", { teamId: developmentTeam }],
      [
        "@jamsch/expo-speech-recognition",
        {
          microphonePermission:
            "Allow $(PRODUCT_NAME) to use the microphone for voice input",
        },
      ],
      "expo-secure-store",
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
      bundleIdentifier: iosBundleIdentifier,
      infoPlist: {
        NSLocalNetworkUsageDescription:
          "This app connects to SSH servers on your local network to manage remote development tools.",
        NSBonjourServices: ["_ssh._tcp"],
      },
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#0b1220",
      },
      package: androidPackage,
    },
  };
};
