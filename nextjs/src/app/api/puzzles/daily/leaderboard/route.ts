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

    // Build participants as: current user UNION their directed friends
    // Then join to users and today's completion in Pacific time
    const { rows } = await query<LeaderboardRow>(
      `WITH participants AS (
         SELECT $1::uuid AS user_id
         UNION
         SELECT f.friend_user_id AS user_id
         FROM friends f
         WHERE f.user_id = $1
       )
       SELECT u.username AS username, pc.time_ms AS time_ms
       FROM participants p
       JOIN users u ON u.user_id = p.user_id
       LEFT JOIN puzzle_completions pc
         ON pc.user_id = u.user_id AND pc.puzzle_date = ${PACIFIC_TODAY_DATE_SQL}
       WHERE u.username IS NOT NULL
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


