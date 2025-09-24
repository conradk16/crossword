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

type WordLoc = {
  word: string;
  x: number; // column index
  y: number; // row index
  direction: 'across' | 'down';
};

// GET /api/admin/boards/get_word_locs_by_date?date=MM-DD-YYYY
// Requires x-admin-secret header. Returns list of words with starting coords.
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

    if (!/^\d{2}-\d{2}-\d{4}$/.test(dateParam)) {
      return NextResponse.json({ error: 'Invalid date format. Use MM-DD-YYYY' }, { status: 400 });
    }

    const [mm, dd, yyyy] = dateParam.split('-');
    const isoDate = `${yyyy}-${mm}-${dd}`;

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

    const puzzle = rows[0].data;
    const grid = puzzle.grid;
    if (!Array.isArray(grid) || grid.length === 0 || !Array.isArray(grid[0])) {
      return NextResponse.json({ error: 'Invalid stored grid' }, { status: 500 });
    }

    const words: WordLoc[] = [];

    const numRows = grid.length;
    const numCols = grid[0].length;

    // Across words
    for (let r = 0; r < numRows; r++) {
      let c = 0;
      while (c < numCols) {
        if (grid[r][c] !== null && (c === 0 || grid[r][c - 1] === null)) {
          let cc = c;
          let word = '';
          while (cc < numCols && grid[r][cc] !== null) {
            word += grid[r][cc] as string;
            cc++;
          }
          if (word.length > 1) {
            words.push({ word, x: c, y: r, direction: 'across' });
          }
          c = cc;
        } else {
          c++;
        }
      }
    }

    // Down words
    for (let c = 0; c < numCols; c++) {
      let r = 0;
      while (r < numRows) {
        if (grid[r][c] !== null && (r === 0 || grid[r - 1][c] === null)) {
          let rr = r;
          let word = '';
          while (rr < numRows && grid[rr][c] !== null) {
            word += grid[rr][c] as string;
            rr++;
          }
          if (word.length > 1) {
            words.push({ word, x: c, y: r, direction: 'down' });
          }
          r = rr;
        } else {
          r++;
        }
      }
    }

	const across = words
		.filter((w) => w.direction === 'across')
		.map(({ word, x, y }) => ({ word, x, y }));

	const down = words
		.filter((w) => w.direction === 'down')
		.map(({ word, x, y }) => ({ word, x, y }));

	return NextResponse.json({ date: rows[0].date, words, across, down });
  } catch (err) {
    console.error('GET /api/admin/boards/get_word_locs_by_date error', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}


