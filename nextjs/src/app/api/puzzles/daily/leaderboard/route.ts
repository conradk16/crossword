import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAuthUser } from '@/lib/auth/session';

// Keep the same Pacific-day logic as the complete endpoint
const PACIFIC_TODAY_DATE_SQL = `(now() AT TIME ZONE 'America/Los_Angeles')::date`;

type LeaderboardRow = {
  username: string | null;
  time_ms: number | null;
};

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all directed friends of the current user with their username
    // Then left join today's completion in Pacific time
    const { rows } = await query<LeaderboardRow>(
      `SELECT u.username AS username, pc.time_ms AS time_ms
       FROM friends f
       JOIN users u ON u.user_id = f.friend_user_id
       LEFT JOIN puzzle_completions pc
         ON pc.user_id = u.user_id AND pc.puzzle_date = ${PACIFIC_TODAY_DATE_SQL}
       WHERE f.user_id = $1 AND u.username IS NOT NULL
       ORDER BY (pc.time_ms IS NULL) ASC, pc.time_ms ASC, u.username ASC`,
      [user.user_id]
    );

    // Map to desired response shape with nulls last already handled by ORDER BY
    const result = rows.map(r => ({ username: r.username, timeMs: r.time_ms }));
    return NextResponse.json(result);
  } catch (err) {
    console.error('GET /api/puzzles/daily/leaderboard error', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}


