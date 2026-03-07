import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus, Pressable, Text, View } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import AsyncStorage from "@react-native-async-storage/async-storage";

const BIOMETRIC_ENABLED_KEY = "biometricEnabled";
const RELOCK_TIMEOUT_MS = 30_000;

type BiometricType = "faceid" | "touchid" | "fingerprint" | "none";

function getBiometricLabel(type: BiometricType): string {
  switch (type) {
    case "faceid": return "Face ID";
    case "touchid": return "Touch ID";
    case "fingerprint": return "Fingerprint";
    default: return "Biometric";
  }
}

async function detectBiometricType(): Promise<BiometricType> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  if (!hasHardware) return "none";
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!enrolled) return "none";
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return "faceid";
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return "fingerprint";
  return "fingerprint";
}

async function authenticate(biometricType: BiometricType): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: `Unlock with ${getBiometricLabel(biometricType)}`,
    cancelLabel: "Cancel",
    disableDeviceFallback: false,
  });
  return result.success;
}

// ---------------------------------------------------------------------------
// Lock screen
// ---------------------------------------------------------------------------

function LockScreen({
  biometricType,
  onTryAgain,
}: {
  biometricType: BiometricType;
  onTryAgain: () => void;
}): JSX.Element {
  const label = getBiometricLabel(biometricType);
  return (
    <View className="flex-1 bg-background items-center justify-center px-8">
      <Text className="text-foreground text-2xl font-bold">Locked</Text>
      <Text className="text-dimmed text-base mt-2 text-center">
        Authenticate with {label} to continue
      </Text>
      <Pressable
        className="bg-accent rounded-full py-4 px-8 mt-6 items-center active:opacity-80"
        onPress={onTryAgain}
      >
        <Text className="text-white font-bold text-base">Unlock with {label}</Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// BiometricGate
// ---------------------------------------------------------------------------

export function BiometricGate({ children }: { children: React.ReactNode }): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [biometricType, setBiometricType] = useState<BiometricType>("none");
  const backgroundTimestamp = useRef<number | null>(null);

  // Initialization
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const type = await detectBiometricType();
      if (cancelled) return;
      setBiometricType(type);

      if (type === "none") {
        setLoading(false);
        return;
      }

      const enabled = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);

      if (cancelled) return;

      if (enabled === "true") {
        // Biometric is enabled — require authentication
        setLocked(true);
        setLoading(false);
        const success = await authenticate(type);
        if (!cancelled && success) {
          setLocked(false);
        }
      } else {
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // AppState re-lock
  useEffect(() => {
    const handleAppStateChange = async (nextState: AppStateStatus) => {
      if (nextState === "background" || nextState === "inactive") {
        backgroundTimestamp.current = Date.now();
      } else if (nextState === "active") {
        const enabled = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);
        if (enabled !== "true" || biometricType === "none") return;

        const elapsed = backgroundTimestamp.current
          ? Date.now() - backgroundTimestamp.current
          : 0;
        backgroundTimestamp.current = null;

        if (elapsed > RELOCK_TIMEOUT_MS) {
          setLocked(true);
          const success = await authenticate(biometricType);
          if (success) setLocked(false);
        }
      }
    };

    const sub = AppState.addEventListener("change", handleAppStateChange);
    return () => sub.remove();
  }, [biometricType]);

  const handleTryAgain = useCallback(async () => {
    const success = await authenticate(biometricType);
    if (success) setLocked(false);
  }, [biometricType]);

  if (loading) {
    return <View className="flex-1 bg-background" />;
  }

  if (locked) {
    return <LockScreen biometricType={biometricType} onTryAgain={handleTryAgain} />;
  }

  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// Hook for Settings
// ---------------------------------------------------------------------------

export function useBiometricSettings() {
  const [enabled, setEnabledState] = useState(false);
  const [biometricType, setBiometricType] = useState<BiometricType>("none");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const type = await detectBiometricType();
      setBiometricType(type);
      if (type !== "none") {
        const val = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);
        setEnabledState(val === "true");
      }
      setLoading(false);
    })();
  }, []);

  const toggle = useCallback(async (value: boolean): Promise<boolean> => {
    // Always verify identity before changing
    const type = await detectBiometricType();
    if (type === "none") return false;
    const success = await authenticate(type);
    if (!success) return false;
    await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, value ? "true" : "false");
    setEnabledState(value);
    return true;
  }, []);

  return {
    enabled,
    toggle,
    biometricType,
    biometricLabel: getBiometricLabel(biometricType),
    available: biometricType !== "none",
    loading,
  };
}
