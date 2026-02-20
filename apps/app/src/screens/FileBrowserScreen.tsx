import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useRoute, useNavigation, type RouteProp } from "@react-navigation/native";
import { useAppStore } from "../state/AppStoreContext";
import { NativeSshClient } from "../core/ssh/nativeSsh";
import type { RemoteFileEntry } from "../core/ssh/fileOps";
import { RemoteFsBrowserController, RequestSupersededError } from "../core/ssh/remoteFsBrowser";
import { loadTargetCredentials } from "../state/secureStore";
import { FileEntryRow } from "../components/FileEntryRow";

type FileBrowserParams = { FileBrowser: { targetId: string; initialPath?: string } };

export function FileBrowserScreen(): JSX.Element {
  const route = useRoute<RouteProp<FileBrowserParams, "FileBrowser">>();
  const navigation = useNavigation<any>();
  const { targetId, initialPath } = route.params;
  const { getTarget } = useAppStore();
  const target = getTarget(targetId);

  const [pathStack, setPathStack] = useState<string[]>(initialPath ? [initialPath] : []);
  const [entries, setEntries] = useState<RemoteFileEntry[]>([]);
  const [resolvingPath, setResolvingPath] = useState(!initialPath);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sshRef = useRef<NativeSshClient | null>(null);
  if (!sshRef.current) {
    sshRef.current = new NativeSshClient();
  }
  const browserRef = useRef<RemoteFsBrowserController | null>(null);

  const currentPath = pathStack[pathStack.length - 1] ?? null;

  useEffect(() => {
    if (!target || !sshRef.current) {
      browserRef.current = null;
      return;
    }

    const browser = new RemoteFsBrowserController({
      ssh: sshRef.current,
      target,
      loadCredentials: async () => await loadTargetCredentials(targetId),
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

  const loadEntries = useCallback(async (path: string, mode: "navigate" | "refresh" = "navigate") => {
    if (!target) return;
    if (mode === "refresh") {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const browser = browserRef.current;
      if (!browser) {
        throw new Error("File browser is not ready");
      }
      const result = await browser.list(path);
      setEntries(result);
    } catch (err) {
      if (err instanceof RequestSupersededError) {
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
      if (mode !== "refresh") {
        setEntries([]);
      }
    } finally {
      if (mode === "refresh") {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, [target]);

  useEffect(() => {
    if (!currentPath) return;
    void loadEntries(currentPath);
  }, [currentPath, loadEntries]);

  useEffect(() => {
    navigation.setOptions({ title: currentPath ?? "Files" });
  }, [currentPath, navigation]);

  const handleEntryPress = useCallback((entry: RemoteFileEntry) => {
    if (entry.isDirectory) {
      setPathStack((prev) => [...prev, entry.path]);
    } else {
      navigation.navigate("FileViewer", { targetId, filePath: entry.path });
    }
  }, [navigation, targetId]);

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

  const breadcrumbPath = currentPath ?? "/";
  const breadcrumbs = breadcrumbPath.split("/").filter(Boolean);
  const showLoadingState = (resolvingPath || loading) && entries.length === 0;

  return (
    <View className="flex-1 bg-background">
      {/* Breadcrumbs */}
      <View className="flex-row items-center px-4 py-2 bg-card border-b border-border flex-wrap">
        <Pressable onPress={() => setPathStack(["/"])} disabled={currentPath === null}>
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

      {/* Back button */}
      {pathStack.length > 1 && (
        <Pressable
          className="flex-row items-center gap-2 px-4 py-2.5 border-b border-border active:bg-muted"
          onPress={handleBack}
        >
          <Text className="text-accent text-sm">{"\u2190"} Back</Text>
        </Pressable>
      )}

      {showLoadingState && (
        <View className="items-center py-8">
          <ActivityIndicator size="small" color="#C4704B" />
        </View>
      )}

      {error && (
        <View className="px-4 py-3">
          <Text className="text-error-bright text-sm">{error}</Text>
        </View>
      )}

      {!showLoadingState && !error && (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.path}
          renderItem={({ item }) => (
            <FileEntryRow entry={item} onPress={() => handleEntryPress(item)} />
          )}
          ListEmptyComponent={
            <View className="items-center py-8">
              <Text className="text-dimmed text-sm">Empty directory</Text>
            </View>
          }
          onRefresh={() => {
            if (!currentPath) return;
            void loadEntries(currentPath, "refresh");
          }}
          refreshing={refreshing}
        />
      )}
    </View>
  );
}
