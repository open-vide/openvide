import React from "react";
import { Pressable, Text, View } from "react-native";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("[OV:ErrorBoundary]", error.message, info.componentStack);
  }

  private handleRestart = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <View className="flex-1 bg-background items-center justify-center px-8">
          <Text className="text-foreground text-xl font-bold mb-3">Something went wrong</Text>
          <Text className="text-muted-foreground text-sm text-center mb-6">
            {this.state.error?.message ?? "An unexpected error occurred."}
          </Text>
          <Pressable
            className="bg-accent rounded-full px-8 py-4 active:opacity-80"
            onPress={this.handleRestart}
          >
            <Text className="text-white font-semibold text-base">Restart</Text>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}
