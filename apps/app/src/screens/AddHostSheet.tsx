import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppStore } from "../state/AppStoreContext";
import { cn } from "../lib/utils";
import type { AuthMethod } from "../core/types";
import type { RootStackParamList } from "../navigation/types";
import { colors } from "../constants/colors";

type Props = NativeStackScreenProps<RootStackParamList, "AddHostSheet">;

const AUTH_METHODS: { value: AuthMethod; label: string }[] = [
  { value: "password", label: "Password" },
  { value: "privateKey", label: "Private Key" },
];

const HOST_REGEX = /^[a-zA-Z0-9._-]+$/;

function validatePort(value: string): string | null {
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 1 || n > 65535) return "Port must be 1\u201365535";
  return null;
}

function validateHost(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "Host is required";
  if (!HOST_REGEX.test(trimmed)) return "Invalid host format";
  return null;
}

type ConnectionPhase = "idle" | "testing" | "saving";

export function AddHostSheet({ navigation }: Props): JSX.Element {
  const { createTarget, testConnectionBeforeSave } = useAppStore();

  const [label, setLabel] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [authMethod, setAuthMethod] = useState<AuthMethod>("password");
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [phase, setPhase] = useState<ConnectionPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const portError = useMemo(() => port.trim().length > 0 ? validatePort(port) : null, [port]);
  const hostError = useMemo(() => touched["host"] ? validateHost(host) : null, [host, touched]);

  const busy = phase !== "idle";

  const canSave =
    label.trim().length > 0 &&
    host.trim().length > 0 &&
    validateHost(host) === null &&
    validatePort(port) === null &&
    username.trim().length > 0 &&
    (authMethod === "password" ? password.trim().length > 0 : privateKey.length > 0);

  const markTouched = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const credentials = {
    password: authMethod === "password" ? password.trim() : undefined,
    privateKey: authMethod !== "password" ? privateKey.trim() : undefined,
    privateKeyPassphrase: authMethod !== "password" && passphrase.trim().length > 0 ? passphrase.trim() : undefined,
  };

  const handleSave = async (): Promise<void> => {
    if (!canSave) return;

    console.log("[OV:ui] AddHostSheet handleSave:", label, username + "@" + host + ":" + port, "auth=" + authMethod);
    setError(null);

    // Step 1: Test SSH connection
    setPhase("testing");
    try {
      const result = await testConnectionBeforeSave({
        host: host.trim(),
        port: parseInt(port, 10) || 22,
        username: username.trim(),
        authMethod,
        credentials,
      });

      if (!result.success) {
        setError("Connection failed: " + (result.error ?? "Unknown error") + ". Check your credentials.");
        setPhase("idle");
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError("Connection test failed: " + msg);
      setPhase("idle");
      return;
    }

    // Step 2: Save host
    setPhase("saving");
    try {
      const target = await createTarget({
        label: label.trim(),
        host: host.trim(),
        port: parseInt(port, 10) || 22,
        username: username.trim(),
        tags: [],
        authMethod,
        credentials,
      });
      console.log("[OV:ui] AddHostSheet: target created", target.id);

      navigation.goBack();
      navigation.navigate("Main", {
        screen: "HostDetail",
        params: { targetId: target.id, autoDetect: true },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[OV:ui] AddHostSheet: createTarget failed:", msg);
      setError(msg);
      setPhase("idle");
    }
  };

  const buttonLabel = phase === "testing" ? "Testing..." : phase === "saving" ? "Saving..." : "Add Host";

  return (
      <ScrollView className="flex-1 bg-card" contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Text className="text-foreground text-[15px] font-bold mt-1">Label</Text>
        <TextInput
          className="bg-muted rounded-2xl p-4 text-foreground text-[16px]"
          value={label}
          onChangeText={setLabel}
          placeholder="My Server"
          placeholderTextColor={colors.dimmed}
        />

        <Text className="text-foreground text-[15px] font-bold mt-1">Host</Text>
        <TextInput
          className="bg-muted rounded-2xl p-4 text-foreground text-[16px]"
          value={host}
          onChangeText={setHost}
          onBlur={() => markTouched("host")}
          placeholder="192.168.1.100"
          placeholderTextColor={colors.dimmed}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {hostError && <Text className="text-error-bright text-xs mt-0.5">{hostError}</Text>}

        <Text className="text-foreground text-[15px] font-bold mt-1">Port</Text>
        <TextInput
          className="bg-muted rounded-2xl p-4 text-foreground text-[16px]"
          value={port}
          onChangeText={setPort}
          placeholder="22"
          placeholderTextColor={colors.dimmed}
          keyboardType="number-pad"
        />
        {portError && <Text className="text-error-bright text-xs mt-0.5">{portError}</Text>}

        <Text className="text-foreground text-[15px] font-bold mt-1">Username</Text>
        <TextInput
          className="bg-muted rounded-2xl p-4 text-foreground text-[16px]"
          value={username}
          onChangeText={setUsername}
          placeholder="root"
          placeholderTextColor={colors.dimmed}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text className="text-foreground text-[15px] font-bold mt-1">Auth Method</Text>
        <View className="flex-row gap-2">
          {AUTH_METHODS.map((method) => (
            <Pressable
              key={method.value}
              className={cn(
                "flex-1 px-4 py-4 bg-muted rounded-lg border-2 items-center",
                authMethod === method.value ? "border-accent" : "border-transparent",
              )}
              onPress={() => setAuthMethod(method.value)}
            >
              <Text className={cn("text-[15px] font-semibold", authMethod === method.value ? "text-accent" : "text-muted-foreground")}>
                {method.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {authMethod === "password" && (
          <>
            <Text className="text-foreground text-[15px] font-bold mt-1">Password</Text>
            <TextInput
              className="bg-muted rounded-2xl p-4 text-foreground text-[16px]"
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={colors.dimmed}
              secureTextEntry
            />
          </>
        )}

        {authMethod !== "password" && (
          <>
            <Text className="text-foreground text-[15px] font-bold mt-1">Private Key (PEM)</Text>
            <TextInput
              className="bg-muted rounded-2xl p-4 text-foreground text-[16px] min-h-[160px]"
              value={privateKey}
              onChangeText={setPrivateKey}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              placeholderTextColor={colors.dimmed}
              multiline
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
            />
          </>
        )}

        {authMethod !== "password" && (
          <>
            <Text className="text-foreground text-[15px] font-bold mt-1">Passphrase (optional)</Text>
            <TextInput
              className="bg-muted rounded-2xl p-4 text-foreground text-[16px]"
              value={passphrase}
              onChangeText={setPassphrase}
              placeholder="Key passphrase"
              placeholderTextColor={colors.dimmed}
              secureTextEntry
            />
          </>
        )}

        {phase === "testing" && (
          <View className="flex-row items-center gap-2 mt-1">
            <ActivityIndicator size="small" color="#C4704B" />
            <Text className="text-muted-foreground text-[13px]">Testing SSH connection...</Text>
          </View>
        )}

        {error && <Text className="text-error-bright text-[13px]">{error}</Text>}

        <Pressable
          className={cn("bg-accent rounded-full py-4 items-center mt-3 flex-row justify-center gap-2", (!canSave || busy) && "opacity-40")}
          onPress={handleSave}
          disabled={!canSave || busy}
        >
          {busy && <ActivityIndicator size="small" color="#ffffff" />}
          <Text className="text-white font-bold text-base">{buttonLabel}</Text>
        </Pressable>
      </ScrollView>
  );
}
