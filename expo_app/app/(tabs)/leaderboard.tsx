import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { HEADER_BOTTOM_MARGIN, HEADER_TOP_MARGIN, SCROLL_CONTENT_HORIZONTAL_PADDING, CONTENT_BOTTOM_PADDING } from '@/constants/Margins';
import { formatTime } from '@/utils/crosswordUtils';
import { useAuth } from '@/services/AuthContext';
import { useFriendRequestCount } from '@/services/FriendRequestCountContext';

type LeaderboardEntry = {
  rank: number;
  user: { id: string; username: string };
  completionTime: number | null;
};
import { withBaseUrl } from '@/constants/Api';

export default function LeaderboardScreen() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [date, setDate] = useState<string>('');
  const [currentUsername, setCurrentUsername] = useState<string | null | undefined>(undefined);
  const [initialLoading, setInitialLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const { token, syncAuth } = useAuth();
  const { syncFriendRequestCount } = useFriendRequestCount();

  const loadLeaderboard = useCallback(async () => {
    try { syncAuth().catch(() => {}); } catch {} // ignore failures
    try { syncFriendRequestCount().catch(() => {}); } catch {} // ignore failures
    if (!token) {
      setLeaderboard([]);
      setDate('');
      setCurrentUsername(null);
      return;
    }
    try {
      const [leaderboardResponse, profileResponse] = await Promise.all([
        fetch(withBaseUrl('/api/puzzles/daily/leaderboard'), {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(withBaseUrl('/api/profile'), {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (profileResponse.ok) {
        const profile: { username?: string | null } = await profileResponse.json();
        setCurrentUsername(profile?.username ?? null);
      }

      if (!leaderboardResponse.ok) {
        setLeaderboard([]);
        setDate('');
        return;
      }
      const rows: Array<{ username: string | null; timeMs: number | null }> = await leaderboardResponse.json();
      const today = new Date().toISOString().split('T')[0];
      setDate(today);
      setLeaderboard((rows || []).map((r, idx) => ({
        rank: idx + 1,
        user: { id: r.username || `user-${idx + 1}`, username: r.username || '(unknown)' },
        completionTime: r.timeMs != null ? Math.floor(r.timeMs / 1000) : null,
      })));
    } catch {}
  }, [token, syncAuth, syncFriendRequestCount]);

  // Refresh leaderboard when the tab is focused
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const run = async () => {
        if (!hasLoadedOnce) {
          setInitialLoading(true);
          try {
            await loadLeaderboard();
          } finally {
            if (!cancelled) {
              setHasLoadedOnce(true);
              setInitialLoading(false);
            }
          }
        } else {
          // Background refresh without toggling loading
          loadLeaderboard();
        }
      };
      run();
      return () => { cancelled = true; };
    }, [loadLeaderboard, hasLoadedOnce])
  );

  // Background refresh when auth token changes (pure context approach)
  useEffect(() => {
    loadLeaderboard();
  }, [token, loadLeaderboard]);

  // Show login prompt if not authenticated
  if (!token) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <ThemedText style={styles.loginPromptTitle}>Log in or register to see the leaderboard!</ThemedText>
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

  if (initialLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <ThemedText style={styles.loadingText}>Loading...</ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  // Show prompt to set username if missing (cannot show leaderboard without it)
  if (currentUsername === null) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <ThemedText style={styles.loginPromptTitle}>Set a username to see the leaderboard!</ThemedText>
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
      <ThemedView style={styles.header}>
        <ThemedText style={styles.title}>Daily Leaderboard</ThemedText>
        <ThemedText style={styles.subtitle}>{date}</ThemedText>
      </ThemedView>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={leaderboard}
        keyExtractor={(item) => `${item.user.id}`}
        renderItem={({ item }) => <LeaderboardRow item={item} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

function LeaderboardRow({ item }: { item: LeaderboardEntry }) {
  const isCurrentUser = item.user.username === 'you';
  const timeText = item.completionTime != null ? formatTime(item.completionTime) : '—';

  return (
    <ThemedView style={[styles.row, isCurrentUser && styles.currentUserRow]}> 
      <View style={styles.rankCol}>
        <ThemedText style={[styles.rank, isCurrentUser && styles.currentUserText]}>{item.rank}</ThemedText>
      </View>
      <View style={styles.nameCol}>
        <ThemedText style={[styles.username, isCurrentUser && styles.currentUserText]} numberOfLines={1}>
          {item.user.username}
        </ThemedText>
      </View>
      <View style={styles.timeCol}>
        <ThemedText style={[styles.time, isCurrentUser && styles.currentUserText]}>{timeText}</ThemedText>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    padding: 8,
    marginTop: HEADER_TOP_MARGIN,
    marginBottom: HEADER_BOTTOM_MARGIN,
    marginLeft: SCROLL_CONTENT_HORIZONTAL_PADDING,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    minHeight: 60,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000000',
  },
  subtitle: {
    marginTop: 2,
    fontSize: 14,
    color: '#333',
  },
  listContent: {
    paddingHorizontal: SCROLL_CONTENT_HORIZONTAL_PADDING,
    paddingBottom: CONTENT_BOTTOM_PADDING,
  },
  separator: {
    height: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#f9f9f9',
  },
  currentUserRow: {
    backgroundColor: '#d4e9ff',
  },
  rankCol: {
    width: 40,
    alignItems: 'flex-start',
  },
  nameCol: {
    flex: 1,
    paddingRight: 12,
  },
  timeCol: {
    width: 80,
    alignItems: 'flex-end',
  },
  rank: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
  },
  username: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  time: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  currentUserText: {
    color: '#007AFF',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loginPromptTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
    marginBottom: 20,
  },
  loadingText: {
    fontSize: 18,
    textAlign: 'center',
    marginTop: 50,
  },
  buttonPrimary: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#007AFF',
    alignItems: 'center',
  },
  buttonPrimaryText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
});
