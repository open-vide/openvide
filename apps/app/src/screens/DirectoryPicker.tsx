import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppStore } from "../state/AppStoreContext";
import { NativeSshClient } from "../core/ssh/nativeSsh";
import type { RemoteFileEntry } from "../core/ssh/fileOps";
import { RemoteFsBrowserController, RequestSupersededError } from "../core/ssh/remoteFsBrowser";
import { loadTargetCredentials } from "../state/secureStore";
import { Icon } from "../components/Icon";
import { useThemeColors } from "../constants/colors";
import { cn } from "../lib/utils";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "DirectoryPicker">;

export function DirectoryPicker({ route, navigation }: Props): JSX.Element {
  const { targetId, currentPath: initialPath, returnTo } = route.params;
  const { getTarget } = useAppStore();
  const target = getTarget(targetId);
  const { accent, dimmed, mutedForeground } = useThemeColors();
  const insets = useSafeAreaInsets();

  const [pathStack, setPathStack] = useState<string[]>(initialPath ? [initialPath] : []);
  const [entries, setEntries] = useState<RemoteFileEntry[]>([]);
  const [resolvingPath, setResolvingPath] = useState(!initialPath);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchVisible, setSearchVisible] = useState(false);
  const sshRef = useRef<NativeSshClient | null>(null);
  if (!sshRef.current) {
    sshRef.current = new NativeSshClient();
  }
  const browserRef = useRef<RemoteFsBrowserController | null>(null);

  const currentDir = pathStack[pathStack.length - 1] ?? null;
  const canSelect = Boolean(currentDir);

  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return entries;
    const q = searchQuery.toLowerCase();
    return entries.filter((e) => e.name.toLowerCase().includes(q));
  }, [entries, searchQuery]);

  useEffect(() => {
    if (!target || !sshRef.current) {
      browserRef.current = null;
      return;
    }

    const browser = new RemoteFsBrowserController({
      ssh: sshRef.current,
      target,
      loadCredentials: async () => await loadTargetCredentials(targetId),
      directoriesOnly: true,
    });
    browserRef.current = browser;

    return () => {
      browserRef.current = null;
      void browser.dispose();
      void sshRef.current?.dispose();
    };
  }, [target, targetId]);

  useEffect(() => {
    if (!target || pathStack.length > 0) return;
    let cancelled = false;
    (async () => {
      setResolvingPath(true);
      try {
        const browser = browserRef.current;
        if (!browser || cancelled) return;
        const home = await browser.resolveStartPath(initialPath);
        if (!cancelled) setPathStack([home]);
      } catch (err) {
        if (cancelled || err instanceof RequestSupersededError) return;
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setPathStack(["/"]);
        }
      } finally {
        if (!cancelled) {
          setResolvingPath(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [initialPath, pathStack.length, target]);

  const loadEntries = useCallback(async (path: string) => {
    if (!target) return;
    setLoading(true);
    setError(null);
    try {
      const browser = browserRef.current;
      if (!browser) {
        throw new Error("Directory browser is not ready");
      }
      const result = await browser.list(path);
      setEntries(result);
    } catch (err) {
      if (err instanceof RequestSupersededError) {
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [target]);

  useEffect(() => {
    if (!currentDir) return;
    setSearchQuery("");
    void loadEntries(currentDir);
  }, [currentDir, loadEntries]);

  useEffect(() => {
    navigation.setOptions({
      title: "Pick Directory",
      headerRight: () => (
        <Pressable
          className="w-9 h-9 items-center justify-center active:opacity-80"
          onPress={() => setSearchVisible((v) => !v)}
        >
          <Icon name="search" size={18} color={mutedForeground} />
        </Pressable>
      ),
    });
  }, [navigation, mutedForeground]);

  const handleSelect = useCallback(() => {
    if (!currentDir) return;
    navigation.navigate(returnTo ?? "NewSessionSheet", { selectedDirectory: currentDir } as never);
  }, [currentDir, navigation, returnTo]);

  const handleEntryPress = useCallback((entry: RemoteFileEntry) => {
    setPathStack((prev) => [...prev, entry.path]);
  }, []);

  const handleBack = useCallback(() => {
    if (pathStack.length > 1) {
      setPathStack((prev) => prev.slice(0, -1));
    } else {
      navigation.goBack();
    }
  }, [pathStack.length, navigation]);

  if (!target) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <Text className="text-dimmed text-sm">Target not found</Text>
      </View>
    );
  }

  const breadcrumbPath = currentDir ?? "/";
  const breadcrumbs = breadcrumbPath.split("/").filter(Boolean);
  const showLoadingState = (resolvingPath || loading) && entries.length === 0;

  return (
    <View className="flex-1 bg-background">
      {/* Search bar */}
      {searchVisible && (
        <View className="px-4 py-2 bg-card border-b border-border">
          <TextInput
            className="bg-muted rounded-2xl px-3.5 py-2.5 text-foreground text-[14px]"
            placeholder="Filter directories..."
            placeholderTextColor={dimmed}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      )}

      {/* Breadcrumbs */}
      <View className="flex-row items-center px-4 py-2 bg-card border-b border-border flex-wrap">
        <Pressable onPress={() => setPathStack(["/"])} disabled={currentDir === null}>
          <Text className="text-accent text-sm font-semibold">/</Text>
        </Pressable>
        {breadcrumbs.map((segment, i) => {
          const segPath = "/" + breadcrumbs.slice(0, i + 1).join("/");
          const isLast = i === breadcrumbs.length - 1;
          return (
            <View key={segPath} className="flex-row items-center">
              <Text className="text-muted-foreground text-sm mx-1">/</Text>
              <Pressable
                onPress={() => {
                  if (!isLast) setPathStack([segPath]);
                }}
              >
                <Text className={isLast ? "text-foreground text-sm font-semibold" : "text-accent text-sm"}>
                  {segment}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      {/* Current selection */}
      <View className="px-4 py-2.5 bg-card border-b border-border">
        <Text className="text-dimmed text-xs">Current selection</Text>
        <Text className="text-foreground text-sm font-semibold mt-0.5">{currentDir ?? "Resolving..."}</Text>
      </View>

      {/* Back button */}
      {pathStack.length > 1 && (
        <Pressable
          className="flex-row items-center gap-2 px-4 py-2.5 border-b border-border active:bg-muted"
          onPress={handleBack}
        >
          <Icon name="chevron-left" size={16} color={accent} />
          <Text className="text-accent text-sm">Back</Text>
        </Pressable>
      )}

      <View className="flex-1">
        {showLoadingState && (
          <View className="items-center py-8">
            <ActivityIndicator size="small" color={accent} />
          </View>
        )}

        {error && (
          <View className="px-4 py-3">
            <Text className="text-error-bright text-sm">{error}</Text>
          </View>
        )}

        {!showLoadingState && !error && (
          <FlatList
            data={filteredEntries}
            keyExtractor={(item) => item.path}
            renderItem={({ item }) => (
              <Pressable
                className="flex-row items-center gap-3 px-4 py-3 border-b border-border active:bg-muted"
                onPress={() => handleEntryPress(item)}
              >
                <Icon name="folder" size={18} color={accent} />
                <Text className="text-foreground text-sm flex-1">{item.name}</Text>
                <Icon name="chevron-right" size={16} color={dimmed} />
              </Pressable>
            )}
            ListEmptyComponent={
              <View className="items-center py-8">
                <Text className="text-dimmed text-sm">
                  {searchQuery ? "No matching directories" : "No subdirectories"}
                </Text>
              </View>
            }
          />
        )}
      </View>

      <View className="px-4 pt-3 border-t border-border bg-background" style={{ paddingBottom: insets.bottom + 12 }}>
        <Pressable
          className={cn("bg-accent rounded-full py-4 items-center flex-row justify-center gap-2", !canSelect && "opacity-40")}
          onPress={handleSelect}
          disabled={!canSelect}
        >
          <Text className="text-white font-bold text-base">Select</Text>
        </Pressable>
      </View>
    </View>
  );
}
