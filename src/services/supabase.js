import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import 'react-native-url-polyfill/auto';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.error(
    '[Supabase] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. Add them to your .env file.',
  );
}

const ExpoSecureStoreAdapter = {
  getItem: async (key) => {
    // expo-secure-store is not available on web / during Node-based bundling.
    if (Platform.OS === 'web' || typeof window === 'undefined') {
      try {
        // Try localStorage first
        const value = globalThis?.localStorage?.getItem(key);
        if (value) return value;
        
        // Fallback to sessionStorage if localStorage fails
        try {
          const sessionValue = globalThis?.sessionStorage?.getItem(key);
          if (sessionValue) return sessionValue;
        } catch (sessionErr) {
          console.warn('[Supabase] SessionStorage access failed:', sessionErr);
        }
        
        // Final fallback to memory (only for development/testing)
        return ExpoSecureStoreAdapter.__memory.get(key) ?? null;
      } catch (err) {
        console.warn('[Supabase] LocalStorage access failed, using memory fallback:', err);
        return ExpoSecureStoreAdapter.__memory.get(key) ?? null;
      }
    }

    try {
      return await SecureStore.getItemAsync(key);
    } catch (err) {
      console.warn('[Supabase] SecureStore access failed:', err);
      return null;
    }
  },
  setItem: async (key, value) => {
    if (Platform.OS === 'web' || typeof window === 'undefined') {
      try {
        // Try localStorage first
        globalThis?.localStorage?.setItem(key, value);
        
        // Also try sessionStorage as backup
        try {
          globalThis?.sessionStorage?.setItem(key, value);
        } catch (sessionErr) {
          console.warn('[Supabase] SessionStorage backup failed:', sessionErr);
        }
        
        // Keep memory backup as well
        ExpoSecureStoreAdapter.__memory.set(key, value);
      } catch (err) {
        console.warn('[Supabase] LocalStorage failed, using sessionStorage and memory:', err);
        try {
          globalThis?.sessionStorage?.setItem(key, value);
          ExpoSecureStoreAdapter.__memory.set(key, value);
        } catch (sessionErr) {
          console.warn('[Supabase] SessionStorage also failed, using memory only:', sessionErr);
          ExpoSecureStoreAdapter.__memory.set(key, value);
        }
      }
      return;
    }

    try {
      await SecureStore.setItemAsync(key, value);
    } catch (err) {
      console.warn('[Supabase] SecureStore setItem failed:', err);
    }
  },
  removeItem: async (key) => {
    if (Platform.OS === 'web' || typeof window === 'undefined') {
      try {
        globalThis?.localStorage?.removeItem(key);
      } catch (err) {
        console.warn('[Supabase] LocalStorage removeItem failed:', err);
      }
      
      try {
        globalThis?.sessionStorage?.removeItem(key);
      } catch (sessionErr) {
        console.warn('[Supabase] SessionStorage removeItem failed:', sessionErr);
      }
      
      ExpoSecureStoreAdapter.__memory.delete(key);
      return;
    }

    try {
      await SecureStore.deleteItemAsync(key);
    } catch (err) {
      console.warn('[Supabase] SecureStore removeItem failed:', err);
    }
  },
  __memory: new Map(),
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export default supabase;
