import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

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

// GET /api/admin/puzzles/get_by_date?date=MM-DD-YYYY
// Requires x-admin-secret header. Returns the puzzle for the given date.
export async function GET(req: NextRequest) {
  try {
    const secret = req.headers.get('x-admin-secret');
    if (!secret || secret !== process.env.CROSSWORD_ADMIN_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get('date');
    if (!dateParam) {
      return NextResponse.json({ error: 'Missing date query param (MM-DD-YYYY)' }, { status: 400 });
    }

    // Validate MM-DD-YYYY format
    if (!/^\d{2}-\d{2}-\d{4}$/.test(dateParam)) {
      return NextResponse.json({ error: 'Invalid date format. Use MM-DD-YYYY' }, { status: 400 });
    }

    const [mm, dd, yyyy] = dateParam.split('-');
    const isoDate = `${yyyy}-${mm}-${dd}`; // YYYY-MM-DD for Postgres date comparison

    const { rows } = await query<{ date: string; data: DbPuzzleData }>(
      `SELECT puzzle_date::text AS date, data
       FROM puzzles
       WHERE puzzle_date = $1
       LIMIT 1`,
      [isoDate]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No puzzle for given date' }, { status: 404 });
    }

    const row = rows[0];
    return NextResponse.json({
      date: row.date,
      ...row.data,
    });
  } catch (err) {
    console.error('GET /api/admin/puzzles/get_by_date error', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}


