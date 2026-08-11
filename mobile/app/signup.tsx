import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Linking } from "react-native";
import { Link, router } from "expo-router";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { styles, colors } from "@/lib/styles";

export default function SignupScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignup() {
    if (!agreed) {
      setError("Please agree to the Terms of Service and Privacy Policy to continue.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      await setDoc(doc(db, "profiles", cred.user.uid), {
        displayName: name,
        createdAt: serverTimestamp(),
      });
      // AuthContext's own onAuthStateChanged listener fires the instant createUserWithEmailAndPassword
      // resolves, with the auth user's displayName still null at that point (updateProfile above
      // hasn't landed yet) — so without this, it writes users/{uid}.displayName as the fallback
      // "Member" and that's what shows up in search/profile pages until the next full login,
      // since profile edits don't re-fire onAuthStateChanged. Set the real name here too so it's
      // correct immediately.
      await setDoc(doc(db, "users", cred.user.uid), { displayName: name }, { merge: true });
      router.replace("/(tabs)/home");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.centered}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Text style={styles.title}>Create your account</Text>

      <TextInput style={styles.input} placeholder="Full name" value={name} onChangeText={setName} />
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

      <TouchableOpacity
        onPress={() => setAgreed((a) => !a)}
        style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 12 }}
      >
        <View
          style={{
            width: 18,
            height: 18,
            borderRadius: 4,
            borderWidth: 1,
            borderColor: colors.line,
            backgroundColor: agreed ? colors.ink : "white",
            alignItems: "center",
            justifyContent: "center",
            marginTop: 1,
          }}
        >
          {agreed && <Text style={{ color: "white", fontSize: 12 }}>✓</Text>}
        </View>
        <Text style={{ fontSize: 12, color: colors.muted, flex: 1, lineHeight: 17 }}>
          I agree to Astryks's{" "}
          <Text style={{ textDecorationLine: "underline" }} onPress={() => Linking.openURL("https://astryks.com/terms")}>
            Terms of Service
          </Text>{" "}
          and{" "}
          <Text style={{ textDecorationLine: "underline" }} onPress={() => Linking.openURL("https://astryks.com/privacy")}>
            Privacy Policy
          </Text>
          .
        </Text>
      </TouchableOpacity>

      {error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity style={styles.buttonPrimary} onPress={handleSignup} disabled={loading}>
        <Text style={styles.buttonPrimaryText}>{loading ? "Creating account…" : "Sign up"}</Text>
      </TouchableOpacity>

      <Link href="/login" style={styles.link}>
        Already have an account? Log in
      </Link>
    </KeyboardAvoidingView>
  );
}
