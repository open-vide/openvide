import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from "react-native";
import { useRoute, useNavigation, type RouteProp } from "@react-navigation/native";
import { useAppStore } from "../state/AppStoreContext";
import { NativeSshClient } from "../core/ssh/nativeSsh";
import type { RemoteFileEntry } from "../core/ssh/fileOps";
import { RemoteFsBrowserController, RequestSupersededError } from "../core/ssh/remoteFsBrowser";
import { loadTargetCredentials } from "../state/secureStore";
import { FileEntryRow } from "../components/FileEntryRow";
import { Icon } from "../components/Icon";
import { useThemeColors } from "../constants/colors";
import { cn } from "../lib/utils";

type FileBrowserParams = { FileBrowser: { targetId: string; initialPath?: string } };

export function FileBrowserScreen(): JSX.Element {
  const route = useRoute<RouteProp<FileBrowserParams, "FileBrowser">>();
  const navigation = useNavigation<any>();
  const { targetId, initialPath } = route.params;
  const { getTarget } = useAppStore();
  const { accent, foreground, mutedForeground } = useThemeColors();
  const target = getTarget(targetId);

  const [pathStack, setPathStack] = useState<string[]>(initialPath ? [initialPath] : []);
  const [entries, setEntries] = useState<RemoteFileEntry[]>([]);
  const [resolvingPath, setResolvingPath] = useState(!initialPath);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"filter" | "find">("filter");
  const [searchResults, setSearchResults] = useState<RemoteFileEntry[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // Client-side filter for "filter" mode
  const filteredEntries = useMemo(() => {
    if (!searchVisible || !searchQuery.trim() || searchMode !== "filter") {
      return entries;
    }
    const q = searchQuery.trim().toLowerCase();
    return entries.filter((e) => e.name.toLowerCase().includes(q));
  }, [entries, searchVisible, searchQuery, searchMode]);

  // Displayed entries: search results in find mode, filtered in filter mode
  const displayedEntries = useMemo(() => {
    if (!searchVisible || !searchQuery.trim()) return entries;
    if (searchMode === "find" && searchResults !== null) return searchResults;
    if (searchMode === "filter") return filteredEntries;
    return entries;
  }, [entries, searchVisible, searchQuery, searchMode, searchResults, filteredEntries]);

  // Debounced remote find search
  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }

    if (!searchVisible || searchMode !== "find" || !searchQuery.trim() || !currentPath) {
      if (searchMode === "find") setSearchResults(null);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    searchDebounceRef.current = setTimeout(() => {
      const browser = browserRef.current;
      if (!browser) {
        setSearchLoading(false);
        return;
      }
      browser
        .search(currentPath, searchQuery.trim())
        .then((results) => {
          setSearchResults(results);
          setSearchLoading(false);
        })
        .catch((err) => {
          if (err instanceof RequestSupersededError) return;
          setSearchLoading(false);
          setSearchResults([]);
        });
    }, 300);

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
    };
  }, [searchVisible, searchMode, searchQuery, currentPath]);

  // Clear search state when navigating directories
  useEffect(() => {
    setSearchQuery("");
    setSearchResults(null);
    setSearchLoading(false);
  }, [currentPath]);

  // Toggle search bar
  const toggleSearch = useCallback(() => {
    setSearchVisible((prev) => {
      if (prev) {
        // Closing: clear query
        setSearchQuery("");
        setSearchResults(null);
        setSearchLoading(false);
      }
      return !prev;
    });
  }, []);

  useEffect(() => {
    navigation.setOptions({
      title: currentPath ?? "Files",
      headerRight: () => (
        <Pressable
          className={cn(
            "w-9 h-9 items-center justify-center active:opacity-80",
          )}
          onPress={toggleSearch}
        >
          <Icon name="search" size={16} color={searchVisible ? accent : mutedForeground} />
        </Pressable>
      ),
    });
  }, [accent, currentPath, navigation, searchVisible, toggleSearch, mutedForeground]);

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

      {/* Search bar */}
      {searchVisible && (
        <View className="px-4 py-2 bg-card border-b border-border">
          <View className="flex-row items-center gap-2">
            <View className="flex-1 flex-row items-center bg-muted rounded-2xl px-3.5">
              <Icon name="search" size={16} color={mutedForeground} />
              <TextInput
                className="flex-1 p-3.5 text-foreground text-[16px]"
                placeholder="Search files..."
                placeholderTextColor={mutedForeground}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
              {searchQuery.length > 0 && (
                <Pressable
                  className="active:opacity-80"
                  onPress={() => {
                    setSearchQuery("");
                    setSearchResults(null);
                  }}
                >
                  <Icon name="x" size={16} color={mutedForeground} />
                </Pressable>
              )}
            </View>
          </View>
          <View className="flex-row gap-2 mt-2">
            <Pressable
              className={cn(
                "flex-1 px-4 py-2.5 items-center rounded-full active:opacity-80",
                searchMode === "filter" ? "bg-accent" : "bg-muted",
              )}
              onPress={() => {
                setSearchMode("filter");
                setSearchResults(null);
                setSearchLoading(false);
              }}
            >
              <Text
                className={cn(
                  "text-sm font-semibold",
                  searchMode === "filter" ? "text-white" : "text-muted-foreground",
                )}
              >
                Filter
              </Text>
            </Pressable>
            <Pressable
              className={cn(
                "flex-1 px-4 py-2.5 items-center rounded-full active:opacity-80",
                searchMode === "find" ? "bg-accent" : "bg-muted",
              )}
              onPress={() => setSearchMode("find")}
            >
              <Text
                className={cn(
                  "text-sm font-semibold",
                  searchMode === "find" ? "text-white" : "text-muted-foreground",
                )}
              >
                Find
              </Text>
            </Pressable>
          </View>
          {searchLoading && (
            <View className="items-center py-2">
              <ActivityIndicator size="small" color={accent} />
            </View>
          )}
        </View>
      )}

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
          data={displayedEntries}
          keyExtractor={(item) => item.path}
          renderItem={({ item }) => (
            <FileEntryRow entry={item} onPress={() => handleEntryPress(item)} />
          )}
          ListEmptyComponent={
            <View className="items-center py-8">
              <Text className="text-dimmed text-sm">
                {searchVisible && searchQuery.trim() ? "No matches found" : "Empty directory"}
              </Text>
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
