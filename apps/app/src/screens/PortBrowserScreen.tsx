import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppStore } from "../state/AppStoreContext";
import { Icon } from "../components/Icon";
import { useThemeColors } from "../constants/colors";
import { NativeSshClient } from "../core/ssh/nativeSsh";
import type { SshCredentials, TargetProfile } from "../core/types";
import { loadTargetCredentials } from "../state/secureStore";
import type { MainStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<MainStackParamList, "PortBrowser">;

interface PortEntry {
  port: number;
  protocol: string;
  process: string;
  address: string;
}

function parsePortOutput(output: string): PortEntry[] {
  if (output.includes("NO_DATA")) return [];

  const lines = output.split("\n").filter((l) => l.trim().length > 0);
  const ports: PortEntry[] = [];
  const seen = new Set<number>();

  for (const line of lines) {
    // ss format: LISTEN 0 128 *:8080 *:* users:(("node",pid=123))
    // netstat format: tcp 0 0 0.0.0.0:8080 0.0.0.0:* LISTEN 123/node
    const portMatch = line.match(/:(\d+)\s/);
    if (!portMatch) continue;
    const port = parseInt(portMatch[1]!, 10);
    if (isNaN(port) || port === 0 || seen.has(port)) continue;
    seen.add(port);

    const processMatch = line.match(/users:\(\("([^"]+)"/) ?? line.match(/\d+\/(\S+)/);
    const process = processMatch?.[1] ?? "unknown";

    ports.push({
      port,
      protocol: "tcp",
      process,
      address: "0.0.0.0",
    });
  }

  return ports.sort((a, b) => a.port - b.port);
}

async function scanPorts(
  ssh: NativeSshClient,
  target: TargetProfile,
  credentials: SshCredentials,
): Promise<PortEntry[]> {
  const cmd = "ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo 'NO_DATA'";
  const handle = await ssh.runCommand(
    target,
    credentials,
    cmd,
    { onStdout: () => {}, onStderr: () => {} },
    { mode: "scripted" },
  );
  const result = await Promise.race([
    handle.wait,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 15000)),
  ]);
  if (!result) {
    await handle.cancel();
    throw new Error("Port scan timed out");
  }
  return parsePortOutput(result.stdout);
}

export function PortBrowserScreen({ route, navigation }: Props): JSX.Element {
  const { targetId } = route.params;
  const { getTarget } = useAppStore();
  const { accent, mutedForeground } = useThemeColors();
  const target = getTarget(targetId);
  const sshRef = useRef(new NativeSshClient());

  const [ports, setPorts] = useState<PortEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = useCallback(async (isRefresh = false) => {
    if (!target) return;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const credentials = await loadTargetCredentials(target.id);
      if (!credentials) throw new Error("No credentials");
      const result = await scanPorts(sshRef.current, target, credentials);
      setPorts(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [target]);

  useEffect(() => {
    void scan();
  }, [scan]);

  useEffect(() => {
    navigation.setOptions({ title: `Ports - ${target?.label ?? "Host"}` });
  }, [navigation, target?.label]);

  const previewUrl = (port: number): string =>
    `http://${target?.host ?? "localhost"}:${port}`;

  if (!target) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <Text className="text-dimmed text-sm">Target not found</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      {error && (
        <View className="px-4 py-3 bg-card border-b border-border">
          <Text className="text-warning text-sm">{error}</Text>
        </View>
      )}

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="small" color={accent} />
          <Text className="text-dimmed text-xs mt-2">Scanning ports...</Text>
        </View>
      ) : (
        <FlatList
          data={ports}
          keyExtractor={(item) => String(item.port)}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void scan(true)}
              tintColor={accent}
            />
          }
          renderItem={({ item }) => (
            <View className="bg-card border border-border rounded-xl p-3.5">
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-2">
                  <View className="w-8 h-8 rounded-full bg-muted items-center justify-center">
                    <Icon name="globe" size={16} color={accent} />
                  </View>
                  <View>
                    <Text className="text-foreground font-bold text-sm">:{item.port}</Text>
                    <Text className="text-muted-foreground text-xs">{item.process} ({item.protocol})</Text>
                  </View>
                </View>
              </View>
              <View className="flex-row gap-2 mt-3">
                <Pressable
                  className="flex-1 flex-row items-center justify-center gap-1.5 bg-accent rounded-lg py-2 active:opacity-80"
                  onPress={() => navigation.navigate("WebPreview", {
                    targetId,
                    url: previewUrl(item.port),
                    title: `Port ${item.port}`,
                  })}
                >
                  <Icon name="eye" size={14} color="#FFFFFF" />
                  <Text className="text-white text-xs font-semibold">Preview</Text>
                </Pressable>
                <Pressable
                  className="flex-1 flex-row items-center justify-center gap-1.5 bg-muted rounded-lg py-2 active:opacity-80"
                  onPress={() => {
                    void Clipboard.setStringAsync(previewUrl(item.port));
                  }}
                >
                  <Icon name="copy" size={14} color={mutedForeground} />
                  <Text className="text-muted-foreground text-xs font-semibold">Copy URL</Text>
                </Pressable>
              </View>
              <Pressable
                className="mt-2 active:opacity-80"
                onPress={() => {
                  const cmd = `ssh -L ${item.port}:localhost:${item.port} ${target.username}@${target.host} -p ${target.port} -N`;
                  void Clipboard.setStringAsync(cmd);
                }}
              >
                <Text className="text-dimmed text-[11px] text-center">Tap to copy SSH tunnel command</Text>
              </Pressable>
            </View>
          )}
          ListEmptyComponent={
            <View className="items-center py-8">
              <Icon name="wifi-off" size={32} color={mutedForeground} />
              <Text className="text-dimmed text-sm mt-2">No open ports found</Text>
            </View>
          }
        />
      )}
    </View>
  );
}
