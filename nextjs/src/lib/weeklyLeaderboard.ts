// Builds the "last 7 days" leaderboard for a user and their friends.
//
// Puzzles vary in difficulty and people skip days, so raw average times aren't comparable.
// Instead each day is scored relative to that day's fastest participant:
//   score = fastest_time / your_time * 100   (100 = fastest that day)
// Missed days are excluded from the average rather than counted as zero, and only days with
// at least two participants count toward it (a solo day would be a free 100). A player needs
// MIN_SCORED_DAYS_TO_RANK scored days to be ranked for the week.

export const WEEK_LENGTH_DAYS = 7;
export const MIN_SCORED_DAYS_TO_RANK = 3;

export type CompletionRow = {
  user_id: string;
  puzzle_date: string; // YYYY-MM-DD
  time_ms: number;
};

export type Participant = {
  user_id: string;
  username: string;
};

export type WeeklyDayResult = {
  played: boolean;
  // 1-based finishing position that day among participants who played (ties share a rank)
  rank: number | null;
  // How many participants played that day
  of: number;
  // Relative speed 1-100, or null if not played or nobody else played that day
  score: number | null;
};

export type WeeklyPlayer = {
  username: string;
  isCurrentUser: boolean;
  days: WeeklyDayResult[];
  daysPlayed: number;
  scoredDays: number;
  // Average of scored days (1-100), or null if no scored days
  avgScore: number | null;
  // Position in the weekly standings, or null if under MIN_SCORED_DAYS_TO_RANK
  weeklyRank: number | null;
};

export type WeeklyLeaderboard = {
  dates: string[]; // oldest -> newest, YYYY-MM-DD
  minScoredDaysToRank: number;
  players: WeeklyPlayer[]; // ranked players by weeklyRank, then unranked
};

export function buildWeeklyLeaderboard(
  dates: string[],
  participants: Participant[],
  completions: CompletionRow[],
  currentUserId: string
): WeeklyLeaderboard {
  // time_ms by date -> user_id
  const timesByDate = new Map<string, Map<string, number>>();
  for (const date of dates) timesByDate.set(date, new Map());
  for (const c of completions) {
    timesByDate.get(c.puzzle_date)?.set(c.user_id, c.time_ms);
  }

  const players: WeeklyPlayer[] = participants.map((p) => {
    const days = dates.map((date): WeeklyDayResult => {
      const times = timesByDate.get(date)!;
      const mine = times.get(p.user_id);
      if (mine == null) return { played: false, rank: null, of: times.size, score: null };
      const all = [...times.values()];
      const fastest = Math.min(...all);
      const rank = all.filter((t) => t < mine).length + 1;
      const score = all.length >= 2 ? Math.max(1, Math.round((fastest / mine) * 100)) : null;
      return { played: true, rank, of: all.length, score };
    });
    const scores = days.map((d) => d.score).filter((s): s is number => s != null);
    return {
      username: p.username,
      isCurrentUser: p.user_id === currentUserId,
      days,
      daysPlayed: days.filter((d) => d.played).length,
      scoredDays: scores.length,
      avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      weeklyRank: null,
    };
  });

  players.sort((a, b) => {
    const aRanked = a.scoredDays >= MIN_SCORED_DAYS_TO_RANK;
    const bRanked = b.scoredDays >= MIN_SCORED_DAYS_TO_RANK;
    if (aRanked !== bRanked) return aRanked ? -1 : 1;
    return (
      (b.avgScore ?? -1) - (a.avgScore ?? -1) ||
      b.daysPlayed - a.daysPlayed ||
      a.username.localeCompare(b.username)
    );
  });

  // Competition ranking among ranked players: equal averages share a rank
  let prev: WeeklyPlayer | null = null;
  players.forEach((p, i) => {
    if (p.scoredDays < MIN_SCORED_DAYS_TO_RANK) return;
    p.weeklyRank = prev && prev.avgScore === p.avgScore ? prev.weeklyRank : i + 1;
    prev = p;
  });

  return { dates, minScoredDaysToRank: MIN_SCORED_DAYS_TO_RANK, players };
}
