import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from "react-native";
import { Link, router } from "expo-router";
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { styles, colors } from "@/lib/styles";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  async function handleLogin() {
    setError(null);
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.replace("/(tabs)/home");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    setError(null);
    if (!email) {
      setError('Enter your email above first, then tap "Forgot password?" again.');
      return;
    }
    setResetLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setResetSent(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.centered}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Text style={styles.title}>Welcome back</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {resetSent ? (
        <Text style={{ color: "#15803D", fontSize: 12, textAlign: "right", marginTop: -6, marginBottom: 8 }}>
          Check your inbox at {email} for a reset link.
        </Text>
      ) : (
        <TouchableOpacity onPress={handleForgotPassword} disabled={resetLoading} style={{ alignSelf: "flex-end", marginTop: -6, marginBottom: 8 }}>
          <Text style={{ color: colors.brand, fontSize: 12, fontWeight: "600" }}>
            {resetLoading ? "Sending…" : "Forgot password?"}
          </Text>
        </TouchableOpacity>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity style={styles.buttonPrimary} onPress={handleLogin} disabled={loading}>
        <Text style={styles.buttonPrimaryText}>{loading ? "Logging in…" : "Log in"}</Text>
      </TouchableOpacity>

      <Link href="/signup" style={styles.link}>
        Don&apos;t have an account? Sign up
      </Link>
    </KeyboardAvoidingView>
  );
}
