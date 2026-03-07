import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useRoute, useNavigation, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAppStore } from "../state/AppStoreContext";
import { NativeSshClient } from "../core/ssh/nativeSsh";
import { loadTargetCredentials } from "../state/secureStore";
import { splitMultiFileDiff } from "../core/diffParser";
import { DiffView, getDiffStats } from "../components/DiffView";
import { useThemeColors } from "../constants/colors";
import type { MainStackParamList } from "../navigation/types";

type Route = RouteProp<MainStackParamList, "SessionDiffs">;
type Nav = NativeStackNavigationProp<MainStackParamList, "SessionDiffs">;

interface FileDiff {
  filePath: string;
  diff: string;
  added: number;
  removed: number;
}

function stripAnsi(text: string): string {
  return text
    .replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g, "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

export function SessionDiffsScreen(): JSX.Element {
  const route = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { targetId, workingDirectory } = route.params;
  const { getTarget } = useAppStore();
  const { accent } = useThemeColors();
  const target = getTarget(targetId);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<FileDiff[]>([]);
  const sshRef = useRef<NativeSshClient | null>(null);
  if (!sshRef.current) {
    sshRef.current = new NativeSshClient();
  }

  useEffect(() => {
    if (!target) {
      setError("Target not found");
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const credentials = await loadTargetCredentials(targetId);
        if (!credentials || cancelled) {
          if (!cancelled) {
            setError("No credentials found");
            setLoading(false);
          }
          return;
        }

        const wd = workingDirectory.replace(/'/g, "'\\''");

        const runCmd = async (command: string, timeout = 20000): Promise<string> => {
          const h = await sshRef.current!.runCommand(
            target, credentials, command,
            { onStdout: () => {}, onStderr: () => {} },
            { mode: "scripted" },
          );
          const r = await Promise.race([
            h.wait,
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Timed out")), timeout)),
          ]);
          return stripAnsi(r.stdout);
        };

        // Tracked file changes (staged + unstaged vs HEAD)
        const trackedOut = await runCmd(`cd '${wd}' && git --no-pager diff HEAD --no-color 2>/dev/null`);
        if (cancelled) return;

        // Untracked files — generate diff-like output for new files
        const untrackedOut = await runCmd(
          `cd '${wd}' && git ls-files --others --exclude-standard 2>/dev/null | while IFS= read -r f; do echo "diff --git a/$f b/$f"; echo "new file mode 100644"; echo "--- /dev/null"; echo "+++ b/$f"; lines=$(wc -l < "$f" 2>/dev/null | tr -d ' ' || echo 0); echo "@@ -0,0 +1,$lines @@"; sed 's/^/+/' "$f" 2>/dev/null; done`,
        );
        if (cancelled) return;

        const combined = (trackedOut + "\n" + untrackedOut).trim();
        const fileDiffs = splitMultiFileDiff(combined);

        if (fileDiffs.length === 0) {
          setDiffs([]);
          setLoading(false);
          return;
        }

        const parsed: FileDiff[] = fileDiffs.map((fd) => {
          const stats = getDiffStats(fd.diff);
          return { filePath: fd.filePath, diff: fd.diff, ...stats };
        });
        setDiffs(parsed);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [target, targetId, workingDirectory]);

  useEffect(() => {
    return () => {
      sshRef.current?.dispose();
    };
  }, []);

  if (loading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="small" color={accent} />
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 bg-background items-center justify-center px-8">
        <Text className="text-dimmed text-[14px] text-center">{error}</Text>
      </View>
    );
  }

  if (diffs.length === 0) {
    return (
      <View className="flex-1 bg-background items-center justify-center px-8">
        <Text className="text-dimmed text-[14px] text-center">No changes detected</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={diffs}
        keyExtractor={(item) => item.filePath}
        contentContainerStyle={{ padding: 16, gap: 16 }}
        renderItem={({ item }) => (
          <Pressable
            className="bg-card rounded-2xl border border-border overflow-hidden active:opacity-80"
            onPress={() =>
              navigation.navigate("DiffViewer", {
                diff: item.diff,
                filePath: item.filePath,
              })
            }
          >
            <View className="px-4 py-3 border-b border-border">
              <Text className="text-foreground text-[14px] font-bold font-mono" numberOfLines={1}>
                {item.filePath}
              </Text>
              <View className="flex-row gap-3 mt-1">
                <Text className="text-[12px]" style={{ color: "#4ade80" }}>
                  +{item.added}
                </Text>
                <Text className="text-[12px]" style={{ color: "#f87171" }}>
                  -{item.removed}
                </Text>
              </View>
            </View>
            <View className="max-h-[200px] overflow-hidden">
              <DiffView diff={item.diff} filePath={item.filePath} />
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}
