import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAuthUser } from '@/lib/auth/session';

type PostBody = {
  timeMs: number;
};

// Helper to consistently compute today's Pacific date on the DB side
const PACIFIC_TODAY_DATE_SQL = `(now() AT TIME ZONE 'America/Los_Angeles')::date`;

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { rows } = await query<{
      puzzle_date: string; // ISO date (YYYY-MM-DD)
      time_ms: number;
      created_at: string;
    }>(
      `SELECT puzzle_date, time_ms, created_at
       FROM puzzle_completions
       WHERE user_id = $1 AND puzzle_date = ${PACIFIC_TODAY_DATE_SQL}
       LIMIT 1`,
      [user.user_id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ completed: false });
    }

    const row = rows[0];
    return NextResponse.json({
      completed: true,
      puzzleDate: row.puzzle_date,
      timeMs: row.time_ms,
    });
  } catch (err) {
    console.error('GET /api/puzzles/daily/complete error', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as Partial<PostBody>;
    const timeMs = Number(body.timeMs);

    if (!Number.isFinite(timeMs)) {
      return NextResponse.json({ error: 'timeMs must be a number' }, { status: 400 });
    }
    if (!Number.isInteger(timeMs) || timeMs <= 0) {
      return NextResponse.json({ error: 'timeMs must be a positive integer' }, { status: 400 });
    }
    // Sanity cap at 24 hours in ms
    if (timeMs > 86_400_000) {
      return NextResponse.json({ error: 'timeMs must be <= 86,400,000 (24h)' }, { status: 400 });
    }

    // Insert for today's Pacific date; rely on unique constraint for idempotency
    const { rows } = await query<{
      id: number;
      puzzle_date: string;
      time_ms: number;
    }>(
      `INSERT INTO puzzle_completions (user_id, puzzle_date, time_ms)
       VALUES ($1, ${PACIFIC_TODAY_DATE_SQL}, $2)
       ON CONFLICT (user_id, puzzle_date) DO NOTHING
       RETURNING id, puzzle_date, time_ms`,
      [user.user_id, timeMs]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Today's completion already recorded" }, { status: 409 });
    }

    const row = rows[0];
    return NextResponse.json(
      {
        completed: true,
        puzzleDate: row.puzzle_date,
        timeMs: row.time_ms,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('POST /api/puzzles/daily/complete error', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}


