import React, { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CameraView, useCameraPermissions } from "expo-camera";
import { decodeQrPayload } from "../core/qrPayload";
import type { RootStackParamList } from "../navigation/types";
import { colors } from "../constants/colors";

type Props = NativeStackScreenProps<RootStackParamList, "QrScannerSheet">;

export function QrScannerSheet({ navigation }: Props): JSX.Element {
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const scannedRef = useRef(false);

  const handleBarcodeScanned = useCallback(
    ({ data }: { data: string }) => {
      if (scannedRef.current) return;
      const payload = decodeQrPayload(data);
      if (!payload) {
        setError("Invalid QR code. Expected an OpenVide connection QR.");
        return;
      }
      scannedRef.current = true;
      navigation.goBack();
      navigation.navigate("AddHostSheet", { qrPayload: payload });
    },
    [navigation],
  );

  if (!permission) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <Text className="text-muted-foreground text-sm">Loading camera...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View className="flex-1 bg-background items-center justify-center px-6 gap-4">
        <Text className="text-foreground text-base text-center">
          Camera access is needed to scan QR codes.
        </Text>
        <Pressable
          className="bg-accent rounded-full px-6 py-3 active:opacity-80"
          onPress={requestPermission}
        >
          <Text className="text-white font-bold text-base">Grant Camera Access</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={handleBarcodeScanned}
      />

      {/* Scanning overlay */}
      <View style={styles.overlayCenter} pointerEvents="none">
        <View
          style={{
            width: 250,
            height: 250,
            borderWidth: 2,
            borderColor: colors.accent,
            borderRadius: 16,
          }}
        />
        <Text className="text-white text-sm mt-4 text-center px-6">
          Point at the QR code shown by{"\n"}
          <Text className="font-mono text-xs">openvide-daemon keygen</Text>
        </Text>
      </View>

      {error && (
        <View className="absolute bottom-20 left-4 right-4 bg-card rounded-xl p-4">
          <Text className="text-error-bright text-sm text-center">{error}</Text>
          <Pressable
            className="mt-3 items-center"
            onPress={() => {
              setError(null);
              scannedRef.current = false;
            }}
          >
            <Text className="text-accent font-semibold text-sm">Try Again</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  overlayCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
});
