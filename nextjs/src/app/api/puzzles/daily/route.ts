import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Compute Pacific date on the DB side to stay consistent with completions/leaderboard
const PACIFIC_TODAY_DATE_SQL = `(now() AT TIME ZONE 'America/Los_Angeles')::date`;

type DbPuzzleData = {
  grid: (string | null)[][];
  clues: Array<{
    clue: string;
    direction: 'across' | 'down';
    row: number;
    col: number;
    length: number;
  }>;
};

export async function GET() {
  try {
    const { rows } = await query<{ date: string; data: DbPuzzleData }>(
      `SELECT puzzle_date::text AS date, data
       FROM puzzles
       WHERE puzzle_date = ${PACIFIC_TODAY_DATE_SQL}
       LIMIT 1`
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No puzzle for today' }, { status: 404 });
    }

    const row = rows[0];

    return NextResponse.json({
      date: row.date,
      ...row.data,
    });
  } catch (err) {
    console.error('GET /api/puzzles/daily error', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}


