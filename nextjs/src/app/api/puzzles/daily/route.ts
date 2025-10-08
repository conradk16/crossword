import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Compute Pacific date on the DB side to stay consistent with completions/leaderboard
const PACIFIC_TODAY_DATE_SQL = `(now() AT TIME ZONE 'America/Los_Angeles')::date`;

// Valid app versions - add new versions here as you release them
// Not providing a version is also accepted (for backward compatibility)
const VALID_APP_VERSIONS = new Set([
  '1.1.1',
]);

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

export async function GET(request: Request) {
  try {
    // Extract app version from query parameters
    const { searchParams } = new URL(request.url);
    const appVersion = searchParams.get('version');
    
    // Check if app version is valid
    // No version provided is accepted (backward compatibility / grandfathered in)
    if (appVersion && !VALID_APP_VERSIONS.has(appVersion)) {
      return NextResponse.json(
        { 
          error: 'APP_UPDATE_REQUIRED',
          message: 'Please update your app to continue playing',
          currentVersion: appVersion
        },
        { status: 426 } // 426 Upgrade Required
      );
    }
    
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


