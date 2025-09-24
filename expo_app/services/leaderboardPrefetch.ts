import { withBaseUrl } from '@/constants/Api';
import { loadPuzzleState } from '@/services/storage';

type CachedLeaderboard = {
  date: string;
  rows: Array<{ username: string | null; timeMs: number | null }>;
  username?: string | null; // current user's username if available
  fetchedAt: number;
} | null;

let cached: CachedLeaderboard = null;

export async function prefetchLeaderboard(token: string): Promise<void> {
  if (!token) return;
  try {
    const [leaderboardResponse, profileResponse] = await Promise.all([
      fetch(withBaseUrl('/api/puzzles/daily/leaderboard'), {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(withBaseUrl('/api/profile'), {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);

    if (!leaderboardResponse.ok) {
      return;
    }

    const rows: Array<{ username: string | null; timeMs: number | null }> = await leaderboardResponse.json();
    let username: string | null | undefined = undefined;
    if (profileResponse.ok) {
      const profile: { username?: string | null } = await profileResponse.json();
      username = profile?.username ?? null;
    }

    const today = new Date().toISOString().split('T')[0];
    cached = {
      date: today,
      rows: rows || [],
      username,
      fetchedAt: Date.now(),
    };
  } catch {
    // swallow errors for background prefetch
  }
}

export function getCachedLeaderboard(): CachedLeaderboard {
  return cached;
}

export function clearCachedLeaderboard(): void {
  cached = null;
}


// Submit any pending completion time for today's puzzle after login,
// then prefetch the leaderboard for instant hydration on navigation.
export async function syncCompletionThenPrefetchLeaderboard(token: string): Promise<void> {
  if (!token) return;
  try {
    const today = new Date().toISOString().split('T')[0];
    const saved = await loadPuzzleState(today);
    const seconds = saved?.completionSeconds || 0;
    if (seconds > 0) {
      try {
        await fetch(withBaseUrl('/api/puzzles/daily/complete'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ timeMs: seconds * 1000 }),
        });
      } catch {
        // ignore submission errors; we'll try again on next login
      }
    }
  } catch {}
  // Regardless of whether we submitted, prefetch leaderboard so it's hot
  try { await prefetchLeaderboard(token); } catch {}
}


