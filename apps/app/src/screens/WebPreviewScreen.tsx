import React, { useCallback, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppStore } from "../state/AppStoreContext";
import { Icon } from "../components/Icon";
import { useThemeColors } from "../constants/colors";
import type { MainStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<MainStackParamList, "WebPreview">;

export function WebPreviewScreen({ route, navigation }: Props): JSX.Element {
  const { targetId, url: initialUrl, title } = route.params;
  const { getTarget } = useAppStore();
  const target = getTarget(targetId);
  const { accent, mutedForeground, dimmed } = useThemeColors();
  const webViewRef = useRef<WebView>(null);
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [urlBarText, setUrlBarText] = useState(initialUrl);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loading, setLoading] = useState(true);

  React.useEffect(() => {
    navigation.setOptions({ title: title ?? "Preview" });
  }, [navigation, title]);

  const handleNavigate = useCallback(() => {
    let url = urlBarText.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "http://" + url;
    }
    setCurrentUrl(url);
  }, [urlBarText]);

  return (
    <View className="flex-1 bg-background">
      {/* URL bar */}
      <View className="flex-row items-center gap-2 px-3 py-2 bg-card border-b border-border">
        <Pressable
          className="w-8 h-8 items-center justify-center active:opacity-80"
          onPress={() => webViewRef.current?.goBack()}
          disabled={!canGoBack}
          style={{ opacity: canGoBack ? 1 : 0.3 }}
        >
          <Icon name="chevron-left" size={18} color={mutedForeground} />
        </Pressable>
        <Pressable
          className="w-8 h-8 items-center justify-center active:opacity-80"
          onPress={() => webViewRef.current?.goForward()}
          disabled={!canGoForward}
          style={{ opacity: canGoForward ? 1 : 0.3 }}
        >
          <Icon name="chevron-right" size={18} color={mutedForeground} />
        </Pressable>
        <TextInput
          className="flex-1 bg-muted rounded-lg px-3 py-1.5 text-foreground text-xs font-mono"
          value={urlBarText}
          onChangeText={setUrlBarText}
          onSubmitEditing={handleNavigate}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          placeholderTextColor={dimmed}
          placeholder="Enter URL..."
        />
        <Pressable
          className="w-8 h-8 items-center justify-center active:opacity-80"
          onPress={() => webViewRef.current?.reload()}
        >
          <Icon name="refresh-cw" size={16} color={mutedForeground} />
        </Pressable>
      </View>

      {/* Loading bar */}
      {loading && (
        <View className="h-0.5 bg-accent" />
      )}

      {/* WebView */}
      <WebView
        ref={webViewRef}
        source={{ uri: currentUrl }}
        className="flex-1"
        onNavigationStateChange={(navState) => {
          setCanGoBack(navState.canGoBack);
          setCanGoForward(navState.canGoForward);
          if (navState.url) setUrlBarText(navState.url);
          setLoading(navState.loading ?? false);
        }}
        onShouldStartLoadWithRequest={(request: WebViewNavigation) => {
          // Restrict navigation to the target host
          try {
            const requestUrl = new URL(request.url);
            const targetHost = target?.host ?? new URL(initialUrl).hostname;
            return requestUrl.hostname === targetHost || requestUrl.hostname === "localhost";
          } catch {
            return false;
          }
        }}
        onError={() => setLoading(false)}
        startInLoadingState
      />
    </View>
  );
}
