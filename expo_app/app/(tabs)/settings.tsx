import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, Keyboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useAuth } from '@/services/AuthContext';
import { getAuthHeaders } from '@/utils/authUtils';
import { withBaseUrl } from '@/constants/Api';
import { SCROLL_CONTENT_HORIZONTAL_PADDING } from '@/constants/Margins';
import { useFriendRequestCount } from '@/services/FriendRequestCountContext';
import { getFriendlyError } from '@/utils/errorUtils';
import { syncCompletionThenPrefetchLeaderboard } from '@/services/leaderboardPrefetch';
import { TextStyles } from '@/constants/TextStyles';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SettingsScreen() {
  const [profile, setProfile] = useState<{ id: string; email: string; username: string } | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Login/Register form state (single button; determine flow via API)
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'enterEmail' | 'enterOtp'>('enterEmail');
  
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isNetworkSubmitError, setIsNetworkSubmitError] = useState(false);
  const [emailErrorVisible, setEmailErrorVisible] = useState(false);
  const [otpAttemptsRemaining, setOtpAttemptsRemaining] = useState<number | null>(null);
  const [otpLastSentByEmail, setOtpLastSentByEmail] = useState<Record<string, number>>({});
  const [resendRemainingSeconds, setResendRemainingSeconds] = useState(60);
  
  
  // Username editing state
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [logoutLoading, setLogoutLoading] = useState(false);

  const { token, setAuthToken, clearAuthToken, syncAuth } = useAuth();
  const { syncFriendRequestCount } = useFriendRequestCount();

  const isEmailInvalid = useMemo(() => {
    const trimmed = email.trim();
    if (trimmed.length === 0) return false;
    return !EMAIL_REGEX.test(trimmed);
  }, [email]);

  const isValidOtp = useMemo(() => /^(\d){6}$/.test(otp.trim()), [otp]);

  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);
  const isEditingUsername = editingUsername || (!!profile && !profile?.username);

  const refreshUserProfile = useCallback(async (tokenOverride?: string) => {
    try { syncAuth().catch(() => {}); } catch {} // ignore failures
    try { syncFriendRequestCount().catch(() => {}); } catch {} // ignore failures
    try {
      const headers = getAuthHeaders(tokenOverride ?? token);
      const r = await fetch(withBaseUrl('/api/profile'), { headers });
      if (r.ok) {
        const data: { user_id: string; email: string; name: string | null; username: string | null } = await r.json();
        setProfile({ id: data.user_id, email: data.email, username: data.username || '' });
      } else if (r.status === 401) {
        setProfile(null);
      } else {
        throw new Error('Failed to load profile');
      }
    } catch (e) {
      throw e;
    }
  }, [token, syncAuth, syncFriendRequestCount]);

  const sendOtp = useCallback(async (forceResend: boolean = false) => {
    setSubmitError(null);
    setIsNetworkSubmitError(false);
    setSubmitMessage(null);
    setOtpAttemptsRemaining(null);
    const trimmed = email.trim();
    const normalized = trimmed.toLowerCase();
    if (trimmed.length === 0 || !EMAIL_REGEX.test(trimmed)) {
      setEmailErrorVisible(true);
      return;
    }
    // If we've already sent an OTP to this email during this session, skip resending unless forced
    if (otpLastSentByEmail[normalized] && !forceResend) {
      setStep('enterOtp');
      return;
    }
    try {
      setSubmitLoading(true);
      const r = await fetch(withBaseUrl('/api/auth/otp/send'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      const json = await r.json();
      if (!r.ok) {
        const errorText = json?.error || 'Failed to send one-time passcode';
        if (r.status === 500 && /Failed to send email/i.test(errorText)) {
          throw new Error('Unable to send email, please try again later');
        }
        throw new Error(errorText);
      }
      setOtpLastSentByEmail((prev) => ({ ...prev, [normalized]: Date.now() }));
      // Ensure button shows disabled state immediately when entering OTP step
      setResendRemainingSeconds(60);
      setSubmitMessage(json?.message || 'Check your email for the one-time passcode');
      setStep('enterOtp');
    } catch (e) {
      const { message, isNetwork } = getFriendlyError(e, 'Failed to send one-time passcode');
      setIsNetworkSubmitError(isNetwork);
      setSubmitError(message);
    } finally {
      setSubmitLoading(false);
    }
  }, [email, otpLastSentByEmail]);

  const completeAuth = useCallback(async () => {
    setSubmitError(null);
    setSubmitMessage(null);
    setIsNetworkSubmitError(false);
    try {
      setSubmitLoading(true);
      const verificationStart = Date.now();
      const body = { email: email.trim(), otp: otp.trim() };
      const r = await fetch(withBaseUrl('/api/auth/otp/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await r.json();
      if (!r.ok) {
        const attempts = typeof json?.attemptsRemaining === 'number' ? json.attemptsRemaining as number : null;
        setOtpAttemptsRemaining(attempts);
        if (attempts === 0) {
          setSubmitError('You have used all one-time passcode attempts for today. Please try again tomorrow.');
        } else if (typeof attempts === 'number') {
          const plural = attempts === 1 ? '' : 's';
          setSubmitError(`Incorrect code. Please be careful — ${attempts} attempt${plural} remaining today.`);
        } else {
          setSubmitError(json?.error || 'Authentication failed');
        }
        return;
      }
      const t = json?.token as string;
      if (t) {
        await setAuthToken(t);
        // After successful login, submit pending completion and prefetch leaderboard
        try { await syncCompletionThenPrefetchLeaderboard(t); } catch {}
      }
      // Clear any prior OTP error state, and keep Verify loading until profile is fetched
      setOtpAttemptsRemaining(null);
      try {
        // Use the freshly received token to avoid races with context updates
        await refreshUserProfile(t);
      } catch {}
      // Ensure a minimum visible verifying duration to avoid brief blank state
      const elapsed = Date.now() - verificationStart;
      const minVerifyMs = 700;
      if (elapsed < minVerifyMs) {
        await new Promise((resolve) => setTimeout(resolve, minVerifyMs - elapsed));
      }
    } catch (e) {
      const { message, isNetwork } = getFriendlyError(e, 'Authentication failed');
      setIsNetworkSubmitError(isNetwork);
      setSubmitError(message);
    } finally {
      setSubmitLoading(false);
    }
  }, [email, otp, refreshUserProfile, setAuthToken]);

  const onLogout = useCallback(async () => {
    setSubmitError(null);
    try {
      setLogoutLoading(true);
      const headers = getAuthHeaders(token);
      await fetch(withBaseUrl('/api/auth/logout'), { method: 'POST', headers });
    } catch {}
    finally {
      const emailKey = (profile?.email || '').trim().toLowerCase();
      if (emailKey) {
        setOtpLastSentByEmail((prev) => {
          if (!prev[emailKey]) return prev;
          const next = { ...prev };
          delete next[emailKey];
          return next;
        });
      }
      await clearAuthToken();
      setProfile(null);
      // Reset auth form state so we return to the regular login (email) page
      setStep('enterEmail');
      setEmail('');
      setOtp('');
      setSubmitMessage(null);
      setSubmitError(null);
      // Clear any network error flags and username editing UI state
      setIsNetworkSubmitError(false);
      setEditingUsername(false);
      setUsernameInput('');
      setUsernameError(null);
      setUsernameLoading(false);
      setEmailErrorVisible(false);
      setOtpAttemptsRemaining(null);
      setResendRemainingSeconds(0);
      setLogoutLoading(false);
    }
  }, [profile?.email, token, clearAuthToken]);

  const checkUsernameAvailability = useCallback(async (username: string): Promise<boolean> => {
    if (!username.trim()) return true;
    try {
      const headers = getAuthHeaders(token);
      const response = await fetch(withBaseUrl(`/api/users/search?prefix=${encodeURIComponent(username)}`), {
        headers
      });
      if (!response.ok) return true; // Assume available if can't check
      const data = await response.json();
      // If any users are returned with exact match, username is taken
      return !(Array.isArray(data) ? data : []).some((u: string) => (u || '').toLowerCase() === username.toLowerCase());
    } catch {
      return true; // Assume available if error
    }
  }, [token]);

  const saveUsername = useCallback(async () => {
    const trimmed = usernameInput.trim();
    if (!trimmed) {
      setUsernameError('Username cannot be empty');
      return;
    }

    // If unchanged, close editor without API calls
    if ((profile?.username || '') === trimmed) {
      setEditingUsername(false);
      setUsernameInput('');
      setUsernameError(null);
      return;
    }
    
    setUsernameLoading(true);
    setUsernameError(null);
    
    try {
      // Check if username is available
      const isAvailable = await checkUsernameAvailability(trimmed);
      if (!isAvailable) {
        setUsernameError('This username is already taken');
        setUsernameLoading(false);
        return;
      }
      
      // Update username
      const headers = {
        ...getAuthHeaders(token),
        'Content-Type': 'application/json'
      };
      const response = await fetch(withBaseUrl('/api/profile'), {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ username: trimmed })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error?.error || 'Failed to update username');
      }
      
      // Refresh profile data
      await refreshUserProfile();
      // After setting username, submit pending completion and prefetch leaderboard
      try { await syncCompletionThenPrefetchLeaderboard(token || ''); } catch {}
      setEditingUsername(false);
      setUsernameInput('');
    } catch (error) {
      const { message } = getFriendlyError(error, 'Failed to update username');
      setUsernameError(message);
    } finally {
      setUsernameLoading(false);
    }
  }, [usernameInput, checkUsernameAvailability, refreshUserProfile, profile?.username, token]);

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

  // Resend countdown timer (1-minute cooldown from last send)
  useEffect(() => {
    if (step !== 'enterOtp') {
      setResendRemainingSeconds(0);
      return;
    }
    const lastSent = otpLastSentByEmail[normalizedEmail];
    if (!lastSent) {
      setResendRemainingSeconds(0);
      return;
    }
    const update = () => {
      const elapsedMs = Date.now() - lastSent;
      const remainingMs = Math.max(0, 60000 - elapsedMs);
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      setResendRemainingSeconds(remainingSeconds);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [step, normalizedEmail, otpLastSentByEmail]);

  // refresh profile on focus
  useFocusEffect(
    React.useCallback(() => {
      setIsNetworkSubmitError(false);
      setSubmitError(null);
      let cancelled = false;
      const run = async () => {
        if (!hasLoadedOnce) {
          setInitialLoading(true);
          try {
            if (token) {
              try {
                await refreshUserProfile();
                setError(null);
              } catch (e) {
                const { message } = getFriendlyError(e, 'Failed to load account');
                setError(message);
              }
            }
          } finally {
            if (!cancelled) {
              setHasLoadedOnce(true);
              setInitialLoading(false);
            }
          }
        } else {
          if (token) {
            // Background refresh without toggling loading
            refreshUserProfile().catch(() => {});
          }
        }
      };
      run();
      return () => { cancelled = true; };
    }, [refreshUserProfile, token, hasLoadedOnce])
  );

  if (initialLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ThemedView style={styles.section}>
          <ThemedText style={styles.loadingText}>Loading...</ThemedText>
        </ThemedView>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ThemedView style={styles.keyboardContainer}>
          <ThemedText style={styles.screenErrorText}>{error}</ThemedText>
        </ThemedView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Pressable style={styles.flex1} onPress={Keyboard.dismiss}>
        {profile ? (
          <ThemedView style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Account</ThemedText>
            
            <View style={styles.row}> 
              <ThemedText style={styles.label}>Email</ThemedText>
              <ThemedText style={styles.value}>{profile.email}</ThemedText>
            </View>
            
            {/* Username row */}
            {!isEditingUsername ? (
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
                    allowFontScaling={false}
                    maxFontSizeMultiplier={1}
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
                    {profile.username ? (
                      <Pressable 
                        style={[styles.editButton, styles.cancelButton]} 
                        onPress={cancelEditingUsername}
                        disabled={usernameLoading}
                      >
                        <ThemedText style={styles.cancelButtonText}>Cancel</ThemedText>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
                {usernameError && (
                  <ThemedText style={[styles.inputError, styles.usernameErrorText]}>{usernameError}</ThemedText>
                )}
              </View>
            )}
            
            <Pressable style={styles.buttonTertiary} onPress={onLogout} disabled={logoutLoading}>
              <ThemedText style={styles.buttonTertiaryText}>{logoutLoading ? 'Logging out…' : 'Log out'}</ThemedText>
            </Pressable>
          </ThemedView>
        ) : (token && !submitLoading) ? null : (
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
                    allowFontScaling={false}
                    maxFontSizeMultiplier={1}
                  />
                  {emailErrorVisible && isEmailInvalid && (
                    <ThemedText style={styles.inputError}>Please enter a valid email address.</ThemedText>
                  )}
                </View>
                <Pressable style={styles.buttonPrimary} onPress={() => sendOtp()} disabled={submitLoading || email.trim().length === 0}>
                  <ThemedText style={styles.buttonPrimaryText}>{submitLoading ? 'Sending…' : 'Login/Register'}</ThemedText>
                </Pressable>
                {submitError && (
                  <ThemedText style={isNetworkSubmitError ? TextStyles.networkInfo : styles.errorText}>
                    {isNetworkSubmitError ? submitError : `${submitError}`}
                  </ThemedText>
                )}
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
                    allowFontScaling={false}
                    maxFontSizeMultiplier={1}
                  />
                  {otpAttemptsRemaining !== null ? (
                    <ThemedText style={styles.inputError}>
                      {otpAttemptsRemaining === 0
                        ? 'You have used all one-time passcode attempts for today. Please try again tomorrow.'
                        : `Incorrect code. Please be careful — ${otpAttemptsRemaining} attempt${otpAttemptsRemaining === 1 ? '' : 's'} remaining today.`}
                    </ThemedText>
                  ) : submitError ? (
                    <ThemedText style={isNetworkSubmitError ? [styles.inputError, styles.usernameErrorText] : styles.inputError}>{submitError}</ThemedText>
                  ) : null}
                </View>
                <View style={styles.actionsRow}>
                  <Pressable
                    style={[styles.buttonPrimary, styles.flex1, !isValidOtp || submitLoading ? styles.buttonPrimaryDisabled : null]}
                    onPress={completeAuth}
                    disabled={submitLoading || !isValidOtp}
                  >
                    <ThemedText allowFontScaling={false} maxFontSizeMultiplier={1} style={[styles.buttonPrimaryText, !isValidOtp || submitLoading ? styles.buttonPrimaryTextDisabled : null]}>
                      {submitLoading ? 'Verifying…' : 'Verify & Continue'}
                    </ThemedText>
                  </Pressable>
                  {resendRemainingSeconds > 0 ? (
                    <Pressable style={[styles.buttonSecondary, styles.flex1]} disabled>
                      <ThemedText allowFontScaling={false} maxFontSizeMultiplier={1} style={styles.buttonSecondaryDisabledText}>
                        {`Resend in ${Math.floor(resendRemainingSeconds / 60)}:${String(resendRemainingSeconds % 60).padStart(2, '0')}`}
                      </ThemedText>
                    </Pressable>
                  ) : (
                    <Pressable style={[styles.buttonSecondary, styles.buttonSecondaryEnabled, styles.flex1]} onPress={() => sendOtp(true)} disabled={submitLoading}>
                      <ThemedText allowFontScaling={false} maxFontSizeMultiplier={1} style={styles.buttonSecondaryEnabledText}>Resend OTP</ThemedText>
                    </Pressable>
                  )}
                </View>
                <Pressable style={styles.buttonLink} onPress={() => { setStep('enterEmail'); setSubmitError(null); setSubmitMessage(null); setOtpAttemptsRemaining(null); }}>
                  <ThemedText style={styles.buttonLinkText}>Back</ThemedText>
                </Pressable>
                
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
  keyboardContainer: {
    flex: 1,
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
    paddingHorizontal: SCROLL_CONTENT_HORIZONTAL_PADDING,
    marginTop: 15,
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
  buttonPrimaryDisabled: {
    backgroundColor: '#f2f2f7',
  },
  buttonPrimaryText: {
    color: '#fff',
    fontWeight: '700',
  },
  buttonPrimaryTextDisabled: {
    color: '#999',
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
  screenErrorText: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 50,
    paddingHorizontal: SCROLL_CONTENT_HORIZONTAL_PADDING,
    color: '#000',
  },
  infoText: {
    fontSize: 16,
    textAlign: 'center',
    color: '#000',
  },
  loadingText: {
    fontSize: 18,
    textAlign: 'center',
    marginTop: 50,
  },
  inputGroup: {
    gap: 6,
  },
  inputError: {
    fontSize: 12,
    color: '#FF3B30',
    paddingLeft: 12,
  },
  usernameErrorText: {
    color: '#000',
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
  editActionsCentered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  editButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: 'center',
    flex: 1,
  },
  editButtonNoFlex: {
    flex: 0,
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
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  buttonSecondary: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#f2f2f7',
    alignItems: 'center',
  },
  buttonSecondaryEnabled: {
    backgroundColor: '#007AFF',
  },
  buttonSecondaryText: {
    color: '#333',
    fontWeight: '700',
  },
  buttonSecondaryDisabledText: {
    color: '#999',
    fontWeight: '700',
  },
  buttonSecondaryEnabledText: {
    color: '#fff',
    fontWeight: '700',
  },
});
