import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View, Keyboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { SCROLL_CONTENT_HORIZONTAL_PADDING } from '@/constants/Margins';
import { useAuth } from '@/services/AuthContext';
import { withBaseUrl } from '@/constants/Api';
import { useFriendRequestCount } from '@/services/FriendRequestCountContext';

type User = { id: string; username: string };
type FriendRequest = { requestId: string; fromUser: { id: string; username: string } };

export default function FriendsScreen() {
  const [query, setQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [lastSearchedQuery, setLastSearchedQuery] = useState('');
  const searchTokenRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [currentUsername, setCurrentUsername] = useState<string | null | undefined>(undefined);
  const [initialLoading, setInitialLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [addedUsernames, setAddedUsernames] = useState<Set<string>>(new Set());
  const { token, syncAuth } = useAuth();
  const { syncFriendRequestCount } = useFriendRequestCount();

  const loadFriends = useCallback(async () => {
    try { syncAuth().catch(() => {}); } catch {} // ignore failures
    try { syncFriendRequestCount().catch(() => {}); } catch {} // ignore failures
    if (!token) {
      setFriendRequests([]);
      setCurrentUsername(null);
      return;
    }
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [requestsResponse, profileResponse] = await Promise.all([
        fetch(withBaseUrl('/api/friends/requests'), { headers }),
        fetch(withBaseUrl('/api/profile'), { headers }),
      ]);

      if (profileResponse.ok) {
        const profile: { username?: string | null } = await profileResponse.json();
        setCurrentUsername(profile?.username ?? null);
      }
      const incomingUsernames: string[] = requestsResponse.ok ? await requestsResponse.json() : [];
      setFriendRequests((incomingUsernames || []).map((u, i) => ({
        requestId: `req-${i + 1}-${u}`,
        fromUser: { id: u, username: u },
      })));
    } catch {}
  }, [token, syncAuth, syncFriendRequestCount]);

  const onSearch = useCallback(async () => {
    setError(null);
    try {
      const trimmed = query.trim();
      if (trimmed.length === 0) {
        setSearchResults([]);
        setLastSearchedQuery('');
        setSearchLoading(false);
        return;
      }
      
      if (!token) return;
      
      const myToken = ++searchTokenRef.current;
      setSearchLoading(true);
      
      const response = await fetch(withBaseUrl(`/api/users/search?prefix=${encodeURIComponent(trimmed)}`), {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (!response.ok) throw new Error('Search failed');
      
      const data: string[] = await response.json();
      
      // Check if this search is still the most recent one
      if (myToken !== searchTokenRef.current) return;
      
      setSearchResults((data || []).map((u) => ({ id: u, username: u })));
      setLastSearchedQuery(trimmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setSearchLoading(false);
    }
  }, [query, token]);

  const handleSendRequest = useCallback(async (recipientId: string) => {
    Keyboard.dismiss();
    setError(null);
    
    if (!token) return;
    
    try {
      const response = await fetch(withBaseUrl('/api/friends/requests/send'), {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ username: recipientId }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to send request');
      }
      setAddedUsernames((prev) => {
        const next = new Set(prev);
        next.add(recipientId);
        return next;
      });
      
      // Refresh friends data and search results
      await loadFriends();
      await onSearch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send request');
    }
  }, [onSearch, loadFriends, token]);

  const handleActOnRequest = useCallback(async (requestId: string, action: 'accept' | 'decline') => {
    Keyboard.dismiss();
    setError(null);
    
    if (!token) return;
    
    try {
      const response = await fetch(withBaseUrl(`/api/friends/requests/respond`), {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ action: action === 'accept' ? 'accept' : 'reject', username: requestId.replace(/^req-\d+-/, '') }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to update request');
      }
      
      await loadFriends();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update request');
    }
  }, [loadFriends, token]);

  // Background refresh when auth token changes (pure context approach)
  useEffect(() => {
    loadFriends();
  }, [token, loadFriends]);

  // Auto-search as user types (debounced)
  useEffect(() => {
    const handle = setTimeout(() => {
      const q = query.trim();
      if (q.length === 0) {
        setSearchResults([]);
        setLastSearchedQuery('');
        setSearchLoading(false);
        return;
      }
      onSearch();
    }, 300);
    return () => clearTimeout(handle);
  }, [query, onSearch]);

  // Refresh friends data and re-render when the tab is focused
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const run = async () => {
        if (!hasLoadedOnce) {
          setInitialLoading(true);
          try {
            await loadFriends();
          } finally {
            if (!cancelled) {
              setHasLoadedOnce(true);
              setInitialLoading(false);
            }
          }
        } else {
          // Background refresh without toggling loading
          loadFriends();
        }
      };
      run();
      return () => { cancelled = true; };
    }, [loadFriends, hasLoadedOnce])
  );

  if (initialLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.section}>
          <ThemedText style={styles.loadingText}>Loading...</ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  // Show login prompt if not authenticated
  if (!token) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <ThemedText style={styles.loginPromptTitle}>Log in or register to add friends!</ThemedText>
          <Pressable 
            style={styles.buttonPrimary} 
            onPress={() => router.push('/settings')}
          >
            <ThemedText style={styles.buttonPrimaryText}>Go to Account</ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // Show prompt to set username if missing (cannot send/receive requests without it)
  if (currentUsername === null) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <ThemedText style={styles.loginPromptTitle}>Set a username to add friends!</ThemedText>
          <Pressable 
            style={styles.buttonPrimary} 
            onPress={() => router.push('/settings')}
          >
            <ThemedText style={styles.buttonPrimaryText}>Go to Account</ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
        <Pressable style={styles.flex1} onPress={Keyboard.dismiss}>

      {/* Requests (incoming only) at top, only when there are active requests */}
      {friendRequests.length > 0 && (
        <View style={styles.sectionSmallGap}>
          <ThemedText style={styles.sectionTitle}>Requests</ThemedText>
          <FlatList
            contentContainerStyle={styles.listContent}
            data={friendRequests}
            keyExtractor={(r) => r.requestId}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            renderItem={({ item }) => (
              <ThemedView style={styles.row}>
                <ThemedText style={styles.username}>{item.fromUser.username}</ThemedText>
                <View style={styles.inlineButtons}>
                  <Pressable style={styles.buttonPrimary} onPress={() => handleActOnRequest(item.requestId, 'accept')}>
                    <ThemedText style={styles.buttonPrimaryText}>Accept</ThemedText>
                  </Pressable>
                  <Pressable style={styles.buttonTertiary} onPress={() => handleActOnRequest(item.requestId, 'decline')}>
                    <ThemedText style={styles.buttonTertiaryText}>Decline</ThemedText>
                  </Pressable>
                </View>
              </ThemedView>
            )}
          />
        </View>
      )}

      {/* Search */}
      <View style={styles.section}>
        <ThemedText style={styles.sectionTitle}>Find Friends</ThemedText>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Search by username"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onBlur={() => {
              Keyboard.dismiss();
            }}
            onTouchStart={(e) => {
              // prevent parent pressable from dismissing keyboard when interacting with the input
              e.stopPropagation();
            }}
          />
          {searchLoading && <ActivityIndicator size="small" color="#8E8E93" />}
        </View>
        {error && (
          <ThemedText style={styles.errorText}>Error: {error}</ThemedText>
        )}
        <FlatList
          contentContainerStyle={styles.listContent}
          data={searchResults}
          keyExtractor={(u) => u.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListEmptyComponent={() => (!searchLoading && query.trim().length > 0 && lastSearchedQuery === query.trim() ? (
            <ThemedText style={styles.muted}>No results</ThemedText>
          ) : null)}
          renderItem={({ item }) => (
            <ThemedView style={styles.row}>
              <ThemedText style={styles.username}>{item.username}</ThemedText>
              <Pressable 
                style={[
                  styles.buttonSecondary,
                  (item.username === currentUsername || addedUsernames.has(item.username)) && styles.buttonDisabled,
                ]} 
                onPress={() => handleSendRequest(item.id)}
                disabled={item.username === currentUsername || addedUsernames.has(item.username)}
              >
                <ThemedText
                  style={[
                    styles.buttonSecondaryText,
                    (item.username === currentUsername || addedUsernames.has(item.username)) && styles.buttonDisabledText,
                  ]}
                >
                  Add
                </ThemedText>
              </Pressable>
            </ThemedView>
          )}
        />
      </View>

      {/* Friends list removed */}
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
    display: 'none',
  },
  section: {
    paddingHorizontal: SCROLL_CONTENT_HORIZONTAL_PADDING,
    marginTop: 15,
  },
  sectionSmallGap: {
    paddingHorizontal: SCROLL_CONTENT_HORIZONTAL_PADDING,
    marginTop: 15,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
    marginBottom: 0,
  },
  subsectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
    marginTop: 7,
    marginBottom: 7,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 7,
  },
  input: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e5ea',
    paddingHorizontal: 12,
    backgroundColor: '#fff',
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
  listContent: {
    paddingTop: 7,
    paddingBottom: 4,
  },
  username: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  inlineButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  buttonPrimary: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#007AFF',
  },
  buttonPrimaryText: {
    color: '#fff',
    fontWeight: '700',
  },
  buttonSecondary: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#d4e9ff',
  },
  buttonSecondaryText: {
    color: '#007AFF',
    fontWeight: '700',
  },
  buttonDisabled: {
    backgroundColor: '#e5e5ea',
  },
  buttonDisabledText: {
    color: '#8E8E93',
  },
  buttonTertiary: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f2f2f7',
  },
  buttonTertiaryText: {
    color: '#FF3B30',
    fontWeight: '700',
  },
  
  muted: {
    color: '#666',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 16,
    textAlign: 'center',
    color: '#FF3B30',
    marginTop: 6,
  },
  loadingText: {
    fontSize: 18,
    textAlign: 'center',
    marginTop: 50,
  },
  loginPromptTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
    marginBottom: 20,
  },
});


