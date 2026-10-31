import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAuthUser } from '@/lib/auth/session';
import { buildWeeklyLeaderboard, WEEK_LENGTH_DAYS, type CompletionRow, type Participant } from '@/lib/weeklyLeaderboard';

// Keep the same Pacific-day logic as the complete endpoint
const PACIFIC_TODAY_DATE_SQL = `(now() AT TIME ZONE 'America/Los_Angeles')::date`;

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Last 7 Pacific days including today, oldest first
    const { rows: dateRows } = await query<{ d: string }>(
      `SELECT to_char(${PACIFIC_TODAY_DATE_SQL} - g, 'YYYY-MM-DD') AS d
       FROM generate_series($1::int - 1, 0, -1) AS g`,
      [WEEK_LENGTH_DAYS]
    );
    const dates = dateRows.map((r) => r.d);

    // Participants are the current user UNION their directed friends, as in the daily leaderboard
    const participantsCte = `WITH participants AS (
         SELECT $1::uuid AS user_id
         UNION
         SELECT f.friend_user_id AS user_id
         FROM friends f
         WHERE f.user_id = $1
       )`;

    const [{ rows: participants }, { rows: completions }] = await Promise.all([
      query<Participant>(
        `${participantsCte}
         SELECT u.user_id::text AS user_id, u.username AS username
         FROM participants p
         JOIN users u ON u.user_id = p.user_id
         WHERE u.username IS NOT NULL`,
        [user.user_id]
      ),
      query<CompletionRow>(
        `${participantsCte}
         SELECT pc.user_id::text AS user_id, to_char(pc.puzzle_date, 'YYYY-MM-DD') AS puzzle_date, pc.time_ms
         FROM puzzle_completions pc
         JOIN participants p ON p.user_id = pc.user_id
         WHERE pc.puzzle_date > ${PACIFIC_TODAY_DATE_SQL} - $2::int`,
        [user.user_id, WEEK_LENGTH_DAYS]
      ),
    ]);

    return NextResponse.json(buildWeeklyLeaderboard(dates, participants, completions, user.user_id));
  } catch (err) {
    console.error('GET /api/puzzles/daily/leaderboard/weekly error', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
