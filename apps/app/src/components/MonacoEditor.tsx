import React, { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const editorHtml = require("../../assets/editor.html");

export interface MonacoEditorRef {
  setContent: (content: string) => void;
  getContent: () => string | null;
  find: (query: string) => void;
  undo: () => void;
  redo: () => void;
  format: () => void;
}

interface MonacoEditorProps {
  initialContent: string;
  language: string;
  onChange?: (content: string, dirty: boolean) => void;
  onSelection?: (info: SelectionInfo) => void;
  onSave?: () => void;
  onReady?: () => void;
}

export interface SelectionInfo {
  startLine: number;
  endLine: number;
  startCol: number;
  endCol: number;
  selectedText: string;
}

function postToWebView(webViewRef: React.RefObject<WebView | null>, message: unknown): void {
  const json = JSON.stringify(message);
  webViewRef.current?.injectJavaScript(`
    window.postMessage(${JSON.stringify(json)}, '*');
    true;
  `);
}

export const MonacoEditor = forwardRef<MonacoEditorRef, MonacoEditorProps>(
  function MonacoEditor({ initialContent, language, onChange, onSelection, onSave, onReady }, ref) {
    const webViewRef = useRef<WebView>(null);
    const contentRef = useRef(initialContent);
    const initializedRef = useRef(false);

    useImperativeHandle(ref, () => ({
      setContent: (content: string) => {
        contentRef.current = content;
        postToWebView(webViewRef, { type: "setContent", content });
      },
      getContent: () => contentRef.current,
      find: (query: string) => postToWebView(webViewRef, { type: "find", query }),
      undo: () => postToWebView(webViewRef, { type: "undo" }),
      redo: () => postToWebView(webViewRef, { type: "redo" }),
      format: () => postToWebView(webViewRef, { type: "format" }),
    }));

    const handleMessage = useCallback((event: WebViewMessageEvent) => {
      try {
        const data = JSON.parse(event.nativeEvent.data) as Record<string, unknown>;
        switch (data.type) {
          case "ready":
            if (!initializedRef.current) {
              initializedRef.current = true;
              postToWebView(webViewRef, {
                type: "init",
                content: initialContent,
                language,
                theme: "vs-dark",
              });
            }
            onReady?.();
            break;
          case "change":
            contentRef.current = data.content as string;
            onChange?.(data.content as string, data.dirty as boolean);
            break;
          case "selection":
            onSelection?.({
              startLine: data.startLine as number,
              endLine: data.endLine as number,
              startCol: data.startCol as number,
              endCol: data.endCol as number,
              selectedText: data.selectedText as string,
            });
            break;
          case "save":
            onSave?.();
            break;
        }
      } catch {
        // Ignore parse errors
      }
    }, [initialContent, language, onChange, onSelection, onSave, onReady]);

    return (
      <View className="flex-1">
        <WebView
          ref={webViewRef}
          source={editorHtml}
          className="flex-1"
          onMessage={handleMessage}
          originWhitelist={["file://*"]}
          javaScriptEnabled
          domStorageEnabled
          scrollEnabled={false}
          bounces={false}
          style={{ backgroundColor: "#1E1E1E" }}
        />
      </View>
    );
  },
);
