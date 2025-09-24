import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

type Direction = 'across' | 'down';

type DbClue = {
  clue: string;
  direction: Direction;
  row: number;
  col: number;
  length: number;
};

type DbPuzzleData = {
  grid: (string | null)[][];
  clues: DbClue[];
};

type InputItem = {
  date: string; // YYYY-MM-DD
  clue: string;
  direction: Direction;
  row: number;
  col: number;
};

// POST /api/admin/clues/bulk_upload
// Accepts NDJSON with shape per line:
// { "date": "YYYY-MM-DD", "clue": string, "direction": "across"|"down", "row": number, "col": number }
// Updates only the specified clues; leaves all other clues for that board unchanged.
export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get('x-admin-secret');
    if (!secret || secret !== process.env.CROSSWORD_ADMIN_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const text = await req.text();
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    const items: InputItem[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch {
        return NextResponse.json({ error: `Invalid JSON on line ${i + 1}` }, { status: 400 });
      }
      const rec = obj as Partial<InputItem>;
      if (!rec?.date || typeof rec.date !== 'string') {
        return NextResponse.json({ error: `Missing or invalid date on line ${i + 1}` }, { status: 400 });
      }
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(rec.date)) {
        return NextResponse.json({ error: `Invalid date format on line ${i + 1}. Use YYYY-MM-DD` }, { status: 400 });
      }
      if (!rec?.clue || typeof rec.clue !== 'string') {
        return NextResponse.json({ error: `Missing or invalid clue on line ${i + 1}` }, { status: 400 });
      }
      if (rec?.direction !== 'across' && rec?.direction !== 'down') {
        return NextResponse.json({ error: `Missing or invalid direction on line ${i + 1} (use 'across' or 'down')` }, { status: 400 });
      }
      if (typeof rec?.row !== 'number' || typeof rec?.col !== 'number' || !Number.isInteger(rec.row) || !Number.isInteger(rec.col)) {
        return NextResponse.json({ error: `Missing or invalid row/col on line ${i + 1} (must be integers)` }, { status: 400 });
      }
      if (rec.row < 0 || rec.col < 0) {
        return NextResponse.json({ error: `row/col must be >= 0 on line ${i + 1}` }, { status: 400 });
      }
      items.push({ date: rec.date, clue: rec.clue, direction: rec.direction, row: rec.row, col: rec.col });
    }

    // Validate dates are later than or equal to today's Pacific date based on DB time
    const { rows: todayRows } = await query<{ today: string }>(
      `SELECT (now() AT TIME ZONE 'America/Los_Angeles')::date AS today`
    );
    const pacificToday = todayRows[0]?.today;
    if (!pacificToday) {
      return NextResponse.json({ error: 'Could not compute Pacific date' }, { status: 500 });
    }
    for (let i = 0; i < items.length; i++) {
      if (items[i].date < pacificToday) {
        return NextResponse.json(
          { error: `date on line ${i + 1} must be later than Pacific today (${pacificToday})` },
          { status: 400 }
        );
      }
    }

    if (items.length === 0) {
      return NextResponse.json({ updated_dates: 0, updated_clues: 0 });
    }

    // Group items by date
    const itemsByDate = new Map<string, InputItem[]>();
    for (const it of items) {
      const arr = itemsByDate.get(it.date) ?? [];
      arr.push(it);
      itemsByDate.set(it.date, arr);
    }

    const dates = Array.from(itemsByDate.keys());

    // Fetch all puzzles for the involved dates
    const placeholders = dates.map((_, i) => `$${i + 1}`).join(', ');
    const { rows: puzzleRows } = await query<{ puzzle_date: string; data: DbPuzzleData }>(
      `SELECT puzzle_date::text AS puzzle_date, data FROM puzzles WHERE puzzle_date IN (${placeholders})`,
      dates
    );

    const dateToPuzzle = new Map<string, DbPuzzleData>();
    for (const r of puzzleRows) {
      dateToPuzzle.set(r.puzzle_date, r.data);
    }

    // Ensure all dates exist
    for (const d of dates) {
      if (!dateToPuzzle.has(d)) {
        return NextResponse.json({ error: `No puzzle exists for date ${d}` }, { status: 400 });
      }
    }

    function computeRunLength(grid: (string | null)[][], row: number, col: number, dir: Direction): number {
      const numRows = grid.length;
      const numCols = grid[0].length;
      if (dir === 'across') {
        let c = col;
        let len = 0;
        while (c < numCols && grid[row][c] !== null) {
          len++;
          c++;
        }
        return len;
      } else {
        let r = row;
        let len = 0;
        while (r < numRows && grid[r][col] !== null) {
          len++;
          r++;
        }
        return len;
      }
    }

    function validateStart(grid: (string | null)[][], row: number, col: number, dir: Direction): { ok: true; length: number } | { ok: false; message: string } {
      const numRows = grid.length;
      const numCols = grid[0].length;
      if (row >= numRows || col >= numCols) {
        return { ok: false, message: `row ${row} col ${col} is out of bounds for grid ${numRows}x${numCols}` };
      }
      if (grid[row][col] === null) {
        return { ok: false, message: `row ${row} col ${col} is a black square` };
      }
      if (dir === 'across') {
        if (!(col === 0 || grid[row][col - 1] === null)) {
          return { ok: false, message: `row ${row} col ${col} is not the start of an across word` };
        }
        const len = computeRunLength(grid, row, col, 'across');
        if (len < 2) {
          return { ok: false, message: `row ${row} col ${col} across run length is ${len} (< 2)` };
        }
        return { ok: true, length: len };
      } else {
        if (!(row === 0 || grid[row - 1][col] === null)) {
          return { ok: false, message: `row ${row} col ${col} is not the start of a down word` };
        }
        const len = computeRunLength(grid, row, col, 'down');
        if (len < 2) {
          return { ok: false, message: `row ${row} col ${col} down run length is ${len} (< 2)` };
        }
        return { ok: true, length: len };
      }
    }

    // Build updates
    let updatedCluesCount = 0;
    const updates: Array<{ date: string; updatedData: DbPuzzleData }> = [];

    for (const d of dates) {
      const data = dateToPuzzle.get(d)!;
      const grid = data.grid;
      if (!Array.isArray(grid) || grid.length === 0 || !Array.isArray(grid[0])) {
        return NextResponse.json({ error: `Invalid stored grid for date ${d}` }, { status: 500 });
      }

      // Copy clues array to avoid mutating original reference
      const newClues: DbClue[] = Array.isArray(data.clues) ? data.clues.map(c => ({ ...c })) : [];

      for (const it of itemsByDate.get(d)!) {
        const validation = validateStart(grid, it.row, it.col, it.direction);
        if (!validation.ok) {
          return NextResponse.json({ error: `Line with date ${it.date} (${it.direction} @ row ${it.row}, col ${it.col}): ${validation.message}` }, { status: 400 });
        }

        const idx = newClues.findIndex(c => c.direction === it.direction && c.row === it.row && c.col === it.col);
        if (idx >= 0) {
          if (newClues[idx].clue !== it.clue) {
            newClues[idx] = { ...newClues[idx], clue: it.clue };
            updatedCluesCount++;
          }
        } else {
          // If a valid start but missing in stored clues, insert it (non-destructive to others)
          newClues.push({ clue: it.clue, direction: it.direction, row: it.row, col: it.col, length: validation.length });
          updatedCluesCount++;
        }
      }

      updates.push({ date: d, updatedData: { grid: data.grid, clues: newClues } });
    }

    // Persist updates
    for (const u of updates) {
      await query(
        `UPDATE puzzles SET data = $2 WHERE puzzle_date = $1`,
        [u.date, u.updatedData]
      );
    }

    return NextResponse.json({ updated_dates: updates.length, updated_clues: updatedCluesCount });
  } catch (err) {
    console.error('POST /api/admin/clues/bulk_upload error', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}


