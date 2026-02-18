import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../services/supabase';

export const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Helper functions for local storage persistence
  const saveRoleToStorage = useCallback((role) => {
    try {
      localStorage.setItem('userRole', role);
    } catch (e) {
      console.warn('[AuthContext] Failed to save role to localStorage:', e);
    }
  }, []);

  const getRoleFromStorage = useCallback(() => {
    try {
      return localStorage.getItem('userRole');
    } catch (e) {
      console.warn('[AuthContext] Failed to get role from localStorage:', e);
      return null;
    }
  }, []);

  const loadProfile = useCallback(async (user) => {
    if (!user) {
      setUserData(null);
      return;
    }

    // Get cached role from localStorage as fallback
    const cachedRole = getRoleFromStorage();
    
    // 1. Set optimistic data from metadata for instant UI responsiveness
    const initialData = {
      id: user.id,
      email: user.email,
      name: user.user_metadata?.full_name || user.user_metadata?.name || user.email,
      role: user.user_metadata?.role || cachedRole || 'student',
    };
    setUserData(initialData);

    // Save the initial role to localStorage if it's different from cached
    if (initialData.role !== cachedRole) {
      saveRoleToStorage(initialData.role);
    }

    // 2. Fetch full profile from DB in background
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (!error && data) {
        // Profile exists, update state with DB data
        const finalRole = data.role || cachedRole || 'student';
        setUserData({
          id: data.id,
          email: data.email,
          name: data.name,
          role: finalRole,
        });
        
        // Update localStorage with the latest role from database
        if (data.role && data.role !== cachedRole) {
          saveRoleToStorage(data.role);
        }
      } else if (!error && !data) {
        // Profile doesn't exist, create it from user metadata
        const profileData = {
          id: user.id,
          email: user.email,
          name: user.user_metadata?.full_name || user.user_metadata?.name || user.email,
          role: user.user_metadata?.role || cachedRole || 'student',
        };

        const { data: newProfile, error: insertError } = await supabase
          .from('profiles')
          .insert(profileData)
          .select()
          .single();

        if (!insertError && newProfile) {
          setUserData(profileData);
          saveRoleToStorage(profileData.role);
        } else if (insertError) {
          console.warn('[AuthContext] Failed to create profile:', insertError);
          
          // Check if it's a permission or table doesn't exist error
          if (insertError.message?.includes('relation "profiles" does not exist')) {
            console.error('[AuthContext] Profiles table does not exist. Please run the setup-database.sql script in Supabase dashboard.');
          } else if (insertError.message?.includes('permission denied')) {
            console.error('[AuthContext] Permission denied. Check RLS policies on profiles table.');
          }
          
          // Keep using optimistic data if insert fails
          console.log('[AuthContext] Using optimistic data as fallback');
        }
      } else if (error) {
        console.warn('[AuthContext] Error fetching profile:', error);
      }
    } catch (e) {
      console.warn('[AuthContext] Profile background fetch failed:', e);
      // If DB fetch fails, at least we have the cached role
      if (cachedRole) {
        setUserData(prev => prev ? { ...prev, role: cachedRole } : null);
      }
    }
  }, [getRoleFromStorage, saveRoleToStorage]);

  const register = useCallback(async (email, password, name, role = 'student') => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: name,
          role,
        },
      },
    });

    if (error) throw error;
    
    // Load profile in background to ensure role is set and profile is created
    if (data?.user) {
      loadProfile(data.user).catch(err => {
        console.warn('[AuthContext] Background profile load failed:', err);
      });
    }
    
    return data;
  }, [loadProfile]);

  const login = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;
    if (data?.user) {
      // Load profile in background to avoid blocking UI
      loadProfile(data.user).catch(err => {
        console.warn('[AuthContext] Background profile load failed:', err);
      });
    }
    return data;
  }, [loadProfile]);

  const logout = useCallback(async () => {
    try {
      // 1. Clear local state immediately for fast UI response
      setCurrentUser(null);
      setUserData(null);

      // 2. Clear cached role from localStorage
      try {
        localStorage.removeItem('userRole');
      } catch (e) {
        console.warn('[AuthContext] Failed to clear role from localStorage:', e);
      }

      // 3. Clear all Supabase channels (non-blocking)
      try {
        const channels = supabase.getChannels();
        if (Array.isArray(channels)) {
          channels.forEach(ch => supabase.removeChannel(ch));
        }
      } catch (e) {
        console.warn('Channel cleanup error:', e);
      }

      // 4. Perform server-side sign out
      await supabase.auth.signOut();

      console.log('Logout successful');
    } catch (error) {
      console.error('Logout failed:', error);
      // State is already cleared above
    }
  }, []);

  const resetPassword = useCallback(async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
  }, []);

  const resendConfirmationEmail = useCallback(async (email) => {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email,
    });
    if (error) throw error;
  }, []);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        console.log('[AuthContext] Initializing auth...');
        
        // Try to get existing session
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        console.log('[AuthContext] Session check result:', { 
          hasSession: !!session, 
          hasUser: !!session?.user,
          error: sessionError 
        });

        if (mounted) {
          if (session?.user) {
            console.log('[AuthContext] Found existing session, setting user and loading profile');
            setCurrentUser(session.user);
            // Load profile in background to avoid blocking UI
            loadProfile(session.user).catch(err => {
              console.warn('[AuthContext] Background profile load failed:', err);
            });
          } else {
            console.log('[AuthContext] No existing session found');
            setCurrentUser(null);
            setUserData(null);
          }
        }
      } catch (err) {
        console.error('[AuthContext] Init error:', err);
        if (mounted) {
          setCurrentUser(null);
          setUserData(null);
        }
      } finally {
        if (mounted) {
          console.log('[AuthContext] Initialization complete, setting loading to false');
          setLoading(false);
        }
      }
    };

    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[AuthContext] Auth state changed:', { event, hasSession: !!session, hasUser: !!session?.user });
      
      if (mounted) {
        if (event === 'SIGNED_OUT') {
          console.log('[AuthContext] User signed out, clearing state');
          setCurrentUser(null);
          setUserData(null);
        } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          if (session?.user) {
            console.log('[AuthContext] User signed in or token refreshed, setting user and loading profile');
            setCurrentUser(session.user);
            // Load profile in background to avoid blocking UI
            loadProfile(session.user).catch(err => {
              console.warn('[AuthContext] Background profile load failed:', err);
            });
          }
        } else if (session?.user) {
          console.log('[AuthContext] Other auth event with session, setting user and loading profile');
          setCurrentUser(session.user);
          // Load profile in background to avoid blocking UI
          loadProfile(session.user).catch(err => {
            console.warn('[AuthContext] Background profile load failed:', err);
          });
        }

        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const value = useMemo(() => ({
    currentUser,
    userData,
    loading,
    register,
    login,
    logout,
    resetPassword,
    resendConfirmationEmail,
  }), [currentUser, userData, loading, register, login, logout, resetPassword, resendConfirmationEmail]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
};
