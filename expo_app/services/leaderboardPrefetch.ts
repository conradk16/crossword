import { withBaseUrl } from '@/constants/Api';

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


