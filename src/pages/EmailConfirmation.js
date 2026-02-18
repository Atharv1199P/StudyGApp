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

const EmailConfirmation = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const router = useRouter();
  const { resendConfirmationEmail } = useAuth();

  const handleResendConfirmation = async () => {
    if (!email.trim()) {
      showAlert('Error', 'Please enter your email address');
      return;
    }

    setResending(true);
    try {
      await resendConfirmationEmail(email.trim());
      showAlert('Confirmation Sent', 'Please check your email for the confirmation link.');
    } catch (e) {
      showAlert('Failed', e?.message || 'Failed to resend confirmation email');
    } finally {
      setResending(false);
    }
  };

  const handleGoToLogin = () => {
    router.replace('/login');
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
            <View style={styles.iconContainer}>
              <Ionicons name="mail-outline" size={48} color="#38bdf8" />
            </View>
            
            <Text style={styles.title}>Confirm your email</Text>
            <Text style={styles.subtitle}>
              We've sent a confirmation email to your registered email address. 
              Please check your inbox and click the confirmation link to activate your account.
            </Text>
          </View>

          {/* Card */}
          <View style={styles.card}>
            {/* Instructions */}
            <View style={styles.instructions}>
              <Text style={styles.instructionsTitle}>Next steps:</Text>
              <View style={styles.stepItem}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>1</Text>
                </View>
                <Text style={styles.stepText}>Check your email inbox</Text>
              </View>
              <View style={styles.stepItem}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>2</Text>
                </View>
                <Text style={styles.stepText}>Click the confirmation link</Text>
              </View>
              <View style={styles.stepItem}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>3</Text>
                </View>
                <Text style={styles.stepText}>Return here to sign in</Text>
              </View>
            </View>

            {/* Resend Section */}
            <View style={styles.resendSection}>
              <Text style={styles.resendText}>Didn't receive the email?</Text>
              <Text style={styles.resendSubtext}>Enter your email to resend the confirmation</Text>
              
              <View style={styles.inputGroup}>
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

              <TouchableOpacity
                style={[styles.resendButton, resending && styles.buttonDisabled]}
                onPress={handleResendConfirmation}
                disabled={resending}
                activeOpacity={0.85}
              >
                <Text style={styles.resendButtonText}>
                  {resending ? 'Sending...' : 'Resend confirmation'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Action Button */}
            <TouchableOpacity
              style={styles.loginButton}
              onPress={handleGoToLogin}
              activeOpacity={0.85}
            >
              <Text style={styles.loginButtonText}>Go to Sign In</Text>
            </TouchableOpacity>
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
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#f8fafc',
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 10,
  },

  /* Card */
  card: {
    backgroundColor: 'rgba(15,23,42,0.85)',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: '#1e293b',
  },

  /* Instructions */
  instructions: {
    marginBottom: 24,
  },
  instructionsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f8fafc',
    marginBottom: 16,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#38bdf8',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  stepNumberText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  stepText: {
    color: '#cbd5f5',
    fontSize: 14,
  },

  /* Resend Section */
  resendSection: {
    marginBottom: 24,
  },
  resendText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#f8fafc',
    marginBottom: 4,
  },
  resendSubtext: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 12,
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
  resendButton: {
    backgroundColor: 'transparent',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#38bdf8',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  resendButtonText: {
    color: '#38bdf8',
    fontSize: 14,
    fontWeight: '600',
  },

  /* Login Button */
  loginButton: {
    backgroundColor: '#0ea5e9',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});

export default EmailConfirmation;
