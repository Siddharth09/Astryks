import { Component, type ReactNode } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { styles } from "@/lib/styles";
import { reportError } from "@/lib/errorReporting";

export default class ErrorBoundary extends Component<
  { children: ReactNode; screen?: string },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    reportError(error, this.props.screen);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.centered}>
          <Text style={{ fontSize: 40, marginBottom: 12, textAlign: "center" }}>⚠️</Text>
          <Text style={styles.title}>Something went wrong</Text>
          <TouchableOpacity style={styles.buttonPrimary} onPress={() => this.setState({ hasError: false })}>
            <Text style={styles.buttonPrimaryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}
