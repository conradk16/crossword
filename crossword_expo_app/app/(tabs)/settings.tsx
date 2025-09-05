import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View, Keyboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { subscribeToState, getAuthState, getProfileState, setAuthToken, clearAuthToken, refreshProfile, sync } from '@/services/state';
import { getAuthHeaders } from '@/utils/authUtils';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SettingsScreen() {
  const [meError, setMeError] = useState<string | null>(null);
  const [profile, setProfile] = useState<{ id: string; email: string; username: string } | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Login/Register form state (single button; determine flow via API)
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'enterEmail' | 'enterOtp'>('enterEmail');
  
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [emailErrorVisible, setEmailErrorVisible] = useState(false);
  
  // Username editing state
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);

  const isEmailInvalid = useMemo(() => {
    const trimmed = email.trim();
    if (trimmed.length === 0) return false;
    return !EMAIL_REGEX.test(trimmed);
  }, [email]);

  const refreshUserProfile = useCallback(async () => {
    setMeError(null);
    try {
      await refreshProfile();
    } catch (e) {
      setMeError('Failed to load profile');
    }
  }, []);

  useEffect(() => {
    refreshUserProfile();
  }, [refreshUserProfile]);

  // Auto-prompt for username if it's blank
  useEffect(() => {
    if (profile && !profile.username && !editingUsername) {
      setEditingUsername(true);
      setUsernameInput('');
    }
  }, [profile, editingUsername]);

  // Subscribe to state changes
  useEffect(() => {
    const unsubscribe = subscribeToState((state) => {
      setIsAuthenticated(state.isAuthenticated);
      setProfile(state.profile);
      setProfileLoading(!state.profile && state.isAuthenticated);
    });
    return unsubscribe;
  }, []);

  const sendOtp = useCallback(async () => {
    setSubmitError(null);
    setSubmitMessage(null);
    if (isEmailInvalid) {
      setEmailErrorVisible(true);
      return;
    }
    try {
      setSubmitLoading(true);
      const r = await fetch('/api/auth/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json?.error || 'Failed to send one-time passcode');
      setSubmitMessage(json?.message || 'Check your email for the one-time passcode');
      setStep('enterOtp');
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to send one-time passcode');
    } finally {
      setSubmitLoading(false);
    }
  }, [email]);

  const completeAuth = useCallback(async () => {
    setSubmitError(null);
    setSubmitMessage(null);
    try {
      setSubmitLoading(true);
      const body = { email: email.trim(), otp: otp.trim() };
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json?.error || 'Authentication failed');
      const token = json?.token as string;
      if (token) await setAuthToken(token);
      await refreshUserProfile();
      // Sync all data after successful login
      await sync();
      setStep('enterEmail');
      setEmail('');
      setOtp('');
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Authentication failed');
    } finally {
      setSubmitLoading(false);
    }
  }, [email, otp, refreshUserProfile]);

  const onLogout = useCallback(async () => {
    setSubmitError(null);
    try {
      setSubmitLoading(true);
      const { token } = getAuthState();
      const headers = getAuthHeaders(token);
      await fetch('/api/auth/logout', { method: 'POST', headers });
    } catch {}
    finally {
      await clearAuthToken();
      setSubmitLoading(false);
    }
  }, []);

  const checkUsernameAvailability = useCallback(async (username: string): Promise<boolean> => {
    if (!username.trim()) return true;
    try {
      const { token } = getAuthState();
      const headers = getAuthHeaders(token);
      const response = await fetch(`/api/users/search?username=${encodeURIComponent(username)}`, {
        headers
      });
      if (!response.ok) return true; // Assume available if can't check
      const data = await response.json();
      // If any users are returned with exact match, username is taken
      return !data.users?.some((user: any) => user.username.toLowerCase() === username.toLowerCase());
    } catch {
      return true; // Assume available if error
    }
  }, []);

  const saveUsername = useCallback(async () => {
    if (!usernameInput.trim()) {
      setUsernameError('Username cannot be empty');
      return;
    }
    
    setUsernameLoading(true);
    setUsernameError(null);
    
    try {
      // Check if username is available
      const isAvailable = await checkUsernameAvailability(usernameInput.trim());
      if (!isAvailable) {
        setUsernameError('This username is already taken');
        setUsernameLoading(false);
        return;
      }
      
      // Update username
      const { token } = getAuthState();
      const headers = getAuthHeaders(token);
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username: usernameInput.trim() })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error?.error || 'Failed to update username');
      }
      
      // Refresh profile data
      await refreshUserProfile();
      setEditingUsername(false);
      setUsernameInput('');
    } catch (error) {
      setUsernameError(error instanceof Error ? error.message : 'Failed to update username');
    } finally {
      setUsernameLoading(false);
    }
  }, [usernameInput, checkUsernameAvailability, refreshUserProfile]);

  const startEditingUsername = useCallback(() => {
    setUsernameInput(profile?.username || '');
    setEditingUsername(true);
    setUsernameError(null);
  }, [profile?.username]);

  const cancelEditingUsername = useCallback(() => {
    setEditingUsername(false);
    setUsernameInput('');
    setUsernameError(null);
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Pressable style={styles.flex1} onPress={Keyboard.dismiss}>
        {profileLoading ? (
          <View style={styles.centered}> 
            <ActivityIndicator size="small" color="#007AFF" />
          </View>
        ) : profile ? (
          <ThemedView style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Account</ThemedText>
            
            <View style={styles.row}> 
              <ThemedText style={styles.label}>Email</ThemedText>
              <ThemedText style={styles.value}>{profile.email}</ThemedText>
            </View>
            
            {/* Username row */}
            {!editingUsername ? (
              <View style={styles.row}>
                <ThemedText style={styles.label}>Username</ThemedText>
                <View style={styles.rowRight}>
                  {profile.username ? (
                    <ThemedText style={styles.value}>{profile.username}</ThemedText>
                  ) : (
                    <ThemedText style={[styles.value, styles.placeholder]}>Not set</ThemedText>
                  )}
                  <Pressable onPress={startEditingUsername} disabled={usernameLoading}>
                    <ThemedText style={styles.editLink}>Edit</ThemedText>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.editRow}>
                <ThemedText style={styles.editLabel}>Username</ThemedText>
                {!profile.username && (
                  <ThemedText style={styles.usernamePrompt}>
                    Please choose a username to identify yourself to friends
                  </ThemedText>
                )}
                <View style={styles.editInputContainer}>
                  <TextInput
                    style={styles.input}
                    value={usernameInput}
                    onChangeText={(text) => {
                      setUsernameInput(text);
                      if (usernameError) setUsernameError(null);
                    }}
                    placeholder="Enter username"
                    autoCapitalize="none"
                    autoCorrect={false}
                    onTouchStart={(e) => { e.stopPropagation(); }}
                  />
                  <View style={styles.editActions}>
                    <Pressable 
                      style={[styles.editButton, styles.saveButton]} 
                      onPress={saveUsername} 
                      disabled={usernameLoading}
                    >
                      <ThemedText style={styles.saveButtonText}>
                        {usernameLoading ? 'Saving…' : 'Save'}
                      </ThemedText>
                    </Pressable>
                    <Pressable 
                      style={[styles.editButton, styles.cancelButton]} 
                      onPress={cancelEditingUsername}
                      disabled={usernameLoading}
                    >
                      <ThemedText style={styles.cancelButtonText}>Cancel</ThemedText>
                    </Pressable>
                  </View>
                </View>
                {usernameError && (
                  <ThemedText style={styles.inputError}>{usernameError}</ThemedText>
                )}
              </View>
            )}
            
            <Pressable style={styles.buttonTertiary} onPress={onLogout} disabled={submitLoading}>
              <ThemedText style={styles.buttonTertiaryText}>{submitLoading ? 'Logging out…' : 'Log out'}</ThemedText>
            </Pressable>
          </ThemedView>
        ) : (
          <ThemedView style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Sign in or create an account</ThemedText>

            {step === 'enterEmail' && (
              <View style={styles.stackGap}>
                <View style={styles.inputGroup}>
                  <TextInput
                    style={styles.input}
                    value={email}
                    onChangeText={(t) => { setEmail(t); if (emailErrorVisible) setEmailErrorVisible(false); }}
                    placeholder="Email"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    onTouchStart={(e) => { e.stopPropagation(); }}
                  />
                  {emailErrorVisible && isEmailInvalid && (
                    <ThemedText style={styles.inputError}>Please enter a valid email address.</ThemedText>
                  )}
                </View>
                <Pressable style={styles.buttonPrimary} onPress={sendOtp} disabled={submitLoading || email.trim().length === 0}>
                  <ThemedText style={styles.buttonPrimaryText}>{submitLoading ? 'Sending…' : 'Login/Register'}</ThemedText>
                </Pressable>
                {submitError && <ThemedText style={styles.errorText}>Error: {submitError}</ThemedText>}
                {submitMessage && <ThemedText style={styles.muted}>{submitMessage}</ThemedText>}
              </View>
            )}

            {step === 'enterOtp' && (
              <View style={styles.stackGap}>
                <ThemedText style={styles.muted}>Enter the 6-digit one-time passcode sent to {email}</ThemedText>
                <View style={styles.inputGroup}>
                  <TextInput
                    style={styles.input}
                    value={otp}
                    onChangeText={setOtp}
                    placeholder="One-time passcode"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="number-pad"
                    onTouchStart={(e) => { e.stopPropagation(); }}
                  />
                  {submitError && submitError.toLowerCase().includes('otp') && (
                    <ThemedText style={styles.inputError}>{submitError}</ThemedText>
                  )}
                </View>
                <Pressable style={styles.buttonPrimary} onPress={completeAuth} disabled={submitLoading || otp.trim().length === 0}>
                  <ThemedText style={styles.buttonPrimaryText}>{submitLoading ? 'Verifying…' : 'Verify & Continue'}</ThemedText>
                </Pressable>
                <Pressable style={styles.buttonLink} onPress={() => { setStep('enterEmail'); setSubmitError(null); setSubmitMessage(null); }}>
                  <ThemedText style={styles.buttonLinkText}>Back</ThemedText>
                </Pressable>
                {submitError && !submitError.toLowerCase().includes('otp') && <ThemedText style={styles.errorText}>Error: {submitError}</ThemedText>}
              </View>
            )}
          </ThemedView>
        )}
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  flex1: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    marginTop: 15,
    marginBottom: 20,
    gap: 8,
  },
  section: {
    paddingHorizontal: 20,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#f9f9f9',
    marginBottom: 8,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  value: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  modeSwitcher: {
    flexDirection: 'row',
    backgroundColor: '#f2f2f7',
    borderRadius: 8,
    padding: 4,
    gap: 4,
  },
  toggle: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 6,
  },
  toggleActive: {
    backgroundColor: '#fff',
  },
  toggleText: {
    color: '#666',
    fontWeight: '700',
  },
  toggleTextActive: {
    color: '#007AFF',
  },
  input: {
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e5ea',
    paddingHorizontal: 12,
    backgroundColor: '#fff',
  },
  stackGap: {
    gap: 10,
    marginTop: 10,
  },
  buttonPrimary: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#007AFF',
    alignItems: 'center',
  },
  buttonPrimaryText: {
    color: '#fff',
    fontWeight: '700',
  },
  buttonTertiary: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#f2f2f7',
    alignItems: 'center',
  },
  buttonTertiaryText: {
    color: '#FF3B30',
    fontWeight: '700',
  },
  buttonLink: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  buttonLinkText: {
    color: '#007AFF',
    fontWeight: '700',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  muted: {
    color: '#666',
  },
  errorText: {
    fontSize: 16,
    textAlign: 'center',
    color: '#FF3B30',
  },
  inputGroup: {
    gap: 6,
  },
  inputError: {
    fontSize: 12,
    color: '#FF3B30',
    paddingLeft: 12,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  placeholder: {
    color: '#999',
    fontStyle: 'italic',
  },
  editLink: {
    color: '#007AFF',
    fontWeight: '600',
    fontSize: 14,
  },
  editRow: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    borderRadius: 10,
    backgroundColor: '#f9f9f9',
    marginBottom: 8,
    gap: 8,
  },
  editLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  editInputContainer: {
    gap: 8,
  },
  editActions: {
    flexDirection: 'row',
    gap: 8,
  },
  editButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: 'center',
    flex: 1,
  },
  saveButton: {
    backgroundColor: '#007AFF',
  },
  saveButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  cancelButton: {
    backgroundColor: '#f2f2f7',
  },
  cancelButtonText: {
    color: '#666',
    fontWeight: '600',
    fontSize: 14,
  },
  usernamePrompt: {
    color: '#666',
    fontSize: 14,
    fontStyle: 'italic',
  },
});
