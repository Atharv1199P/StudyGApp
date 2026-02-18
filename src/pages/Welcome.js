import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  Dimensions,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const { width } = Dimensions.get('window');

const Welcome = () => {
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <StatusBar barStyle="light-content" />

      <LinearGradient
        colors={['#071A52', '#0b1226', '#000000']}
        style={styles.container}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Logo & Title */}
          <View style={styles.header}>
            <View style={styles.iconBox}>
              <Ionicons name="book" size={40} color="#fff" />
            </View>

            <Text style={styles.title}>StudyTogether</Text>
            <Text style={styles.subtitle}>
              Collaborative study rooms, AI-powered tools, and live sessions — all in one place.
            </Text>
          </View>

          {/* Features */}
          <View style={styles.features}>
            <Feature
              icon="people"
              title="Organize Groups"
              desc="Create groups, share files, and run sessions."
            />
            <Feature
              icon="sparkles"
              title="AI Study Tools"
              desc="Summaries, flashcards & quizzes from notes."
            />
            <Feature
              icon="mic"
              title="Live Session Recording"
              desc="Record, transcribe & auto-summarize sessions."
            />
            <Feature
              icon="lock-closed"
              title="Secure Platform"
              desc="Built on Supabase with secure auth."
            />
          </View>

          {/* Buttons */}
          <View style={styles.buttons}>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => router.push('/login')}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryButtonText}>Get Started</Text>
              <Ionicons name="arrow-forward" size={18} color="#fff" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => router.push('/register')}
            >
              <Text style={styles.secondaryButtonText}>Create Account</Text>
            </TouchableOpacity>
          </View>

          {/* Footer */}
          <Text style={styles.footerText}>
            Free for classrooms and study groups — powered by Supabase & Groq
          </Text>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
};

const Feature = ({ icon, title, desc }) => (
  <View style={styles.featureCard}>
    <View style={styles.featureIcon}>
      <Ionicons name={icon} size={22} color="#a5b4fc" />
    </View>
    <View style={{ flex: 1 }}>
      <Text style={styles.featureTitle}>{title}</Text>
      <Text style={styles.featureDesc}>{desc}</Text>
    </View>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 40,
    paddingBottom: 30,
  },

  /* Header */
  header: {
    alignItems: 'center',
    marginVertical: 30,
    marginBottom: 30,
  },
  iconBox: {
    height: 80,
    width: 80,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: '#fff',
  },
  subtitle: {
    fontSize: 14,
    color: '#c7d2fe',
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 20,
  },

  /* Features */
  features: {
    marginVertical: 20,
    gap: 12,
  },
  featureCard: {
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  featureIcon: {
    height: 42,
    width: 42,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  featureDesc: {
    color: '#dbeafe',
    fontSize: 13,
    marginTop: 2,
  },

  /* Buttons */
  buttons: {
    marginTop: 25,
    gap: 12,
  },
  primaryButton: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 14,
    borderRadius: 30,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#e5e7eb',
    fontSize: 15,
    fontWeight: '500',
  },

  /* Footer */
  footerText: {
    marginTop: 22,
    textAlign: 'center',
    fontSize: 12,
    color: '#9ca3af',
  },
});

export default Welcome;
