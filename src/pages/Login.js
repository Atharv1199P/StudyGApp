import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { showAlert } from '../services/alerts';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const router = useRouter();
  const { login } = useAuth();

  const handleLogin = async () => {
    if (!email || !password) {
      showAlert('Error', 'Please enter email and password');
      return;
    }

    setLoading(true);
    try {
      await login(email.trim(), password);
      router.replace('/dashboard');
    } catch (e) {
      const errorMessage = e?.message || 'Invalid credentials';
      
      // Check if error is related to email confirmation
      if (errorMessage.toLowerCase().includes('email') || 
          errorMessage.toLowerCase().includes('confirm') ||
          errorMessage.toLowerCase().includes('verified')) {
        showAlert('Email Not Confirmed', 'Please check your email and confirm your account before signing in.', [
          { text: 'OK', onPress: () => {} },
          { text: 'Resend Email', onPress: () => router.push('/email-confirmation') }
        ]);
      } else {
        showAlert('Login Failed', errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar barStyle="light-content" />

      <LinearGradient
        colors={['#020617', '#020617', '#000']}
        style={styles.container}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.badge}>
              <View style={styles.dot} />
              <Text style={styles.badgeText}>Welcome back to StudyGrid</Text>
            </View>

            <Text style={styles.title}>Sign in</Text>
            <Text style={styles.subtitle}>
              Join your study groups, sessions, and AI workspace.
            </Text>
          </View>

          {/* Card */}
          <View style={styles.card}>
            {/* Email */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor="#64748b"
                keyboardType="email-address"
                autoCapitalize="none"
                style={styles.input}
              />
            </View>

            {/* Password */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.passwordBox}>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor="#64748b"
                  secureTextEntry={!showPassword}
                  style={[styles.input, { paddingRight: 44 }]}
                />
                <TouchableOpacity
                  style={styles.eye}
                  onPress={() => setShowPassword(!showPassword)}
                >
                  <Ionicons
                    name={showPassword ? 'eye-off' : 'eye'}
                    size={20}
                    color="#94a3b8"
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Button */}
            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.85}
            >
              <Text style={styles.buttonText}>
                {loading ? 'Signing in...' : 'Login'}
              </Text>
            </TouchableOpacity>

            {/* Footer */}
            <View style={styles.footer}>
              <Text style={styles.footerText}>Don&apos;t have an account? </Text>
              <TouchableOpacity onPress={() => router.push('/register')}>
                <Text style={styles.footerLink}>Create one</Text>
              </TouchableOpacity>
            </View>

            {/* Email Confirmation Link */}
            <View style={styles.confirmationFooter}>
              <TouchableOpacity onPress={() => router.push('/email-confirmation')}>
                <Text style={styles.confirmationLink}>Need to confirm your email?</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    padding: 20,
    justifyContent: 'center',
  },

  /* Header */
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 16,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#34d399',
  },
  badgeText: {
    color: '#cbd5f5',
    fontSize: 12,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#f8fafc',
  },
  subtitle: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 6,
    textAlign: 'center',
  },

  /* Card */
  card: {
    backgroundColor: 'rgba(15,23,42,0.85)',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1e293b',
  },

  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    color: '#cbd5f5',
    marginBottom: 6,
    fontWeight: '500',
  },
  input: {
    backgroundColor: '#020617',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 12,
    paddingHorizontal: 14,
    color: '#f8fafc',
    fontSize: 14,
  },
  passwordBox: {
    position: 'relative',
  },
  eye: {
    position: 'absolute',
    right: 12,
    top: 12,
  },

  button: {
    backgroundColor: '#0ea5e9',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },

  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 16,
  },
  footerText: {
    color: '#94a3b8',
    fontSize: 12,
  },
  footerLink: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '600',
  },

  confirmationFooter: {
    alignItems: 'center',
    marginTop: 12,
  },
  confirmationLink: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '500',
  },
});

export default Login;
