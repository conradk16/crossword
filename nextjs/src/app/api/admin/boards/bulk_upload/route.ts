import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// POST /api/admin/boards/bulk_upload
// Accepts NDJSON (one JSON object per line) with shape:
// { "date": "YYYY-MM-DD", "board": (string|null)[][] }
// Builds empty clues for all across/down entries and upserts into puzzles by date.
export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get('x-admin-secret');
    if (!secret || secret !== process.env.CROSSWORD_ADMIN_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const text = await req.text();
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    type Item = { date: string; board: (string | null)[][] };
    const items: Item[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch (e) {
        return NextResponse.json({ error: `Invalid JSON on line ${i + 1}` }, { status: 400 });
      }
      const rec = obj as Partial<Item>;
      if (!rec?.date || !rec?.board) {
        return NextResponse.json({ error: `Missing fields on line ${i + 1}` }, { status: 400 });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.date)) {
        return NextResponse.json({ error: `Invalid date on line ${i + 1}` }, { status: 400 });
      }
      if (!Array.isArray(rec.board) || rec.board.length === 0 || !Array.isArray(rec.board[0])) {
        return NextResponse.json({ error: `Invalid board on line ${i + 1}` }, { status: 400 });
      }
      items.push({ date: rec.date, board: rec.board as (string | null)[][] });
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
      return NextResponse.json({ upserted: 0 });
    }

    function buildEmptyClues(board: (string | null)[][]) {
      type Clue = { clue: string; direction: 'across' | 'down'; row: number; col: number; length: number };
      const rows = board.length;
      const cols = board[0].length;
      const clues: Clue[] = [];

      // Across
      for (let r = 0; r < rows; r++) {
        let c = 0;
        while (c < cols) {
          // Start of a run if not black and either at col 0 or previous is black
          if (board[r][c] !== null && (c === 0 || board[r][c - 1] === null)) {
            let length = 0;
            let cc = c;
            while (cc < cols && board[r][cc] !== null) {
              length++;
              cc++;
            }
            if (length > 1) {
              clues.push({ clue: '', direction: 'across', row: r, col: c, length });
            }
            c = cc; // jump to end of run
          } else {
            c++;
          }
        }
      }

      // Down
      for (let c = 0; c < cols; c++) {
        let r = 0;
        while (r < rows) {
          if (board[r][c] !== null && (r === 0 || board[r - 1][c] === null)) {
            let length = 0;
            let rr = r;
            while (rr < rows && board[rr][c] !== null) {
              length++;
              rr++;
            }
            if (length > 1) {
              clues.push({ clue: '', direction: 'down', row: r, col: c, length });
            }
            r = rr;
          } else {
            r++;
          }
        }
      }

      return clues;
    }

    const payloads = items.map(({ date, board }) => ({
      puzzle_date: date,
      data: {
        grid: board,
        clues: buildEmptyClues(board),
      },
    }));

    const valuesSql = payloads.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
    const params = payloads.flatMap(r => [r.puzzle_date, r.data]);

    await query(
      `INSERT INTO puzzles (puzzle_date, data)
       VALUES ${valuesSql}
       ON CONFLICT (puzzle_date) DO UPDATE SET data = EXCLUDED.data`,
      params
    );

    return NextResponse.json({ upserted: payloads.length });
  } catch (err) {
    console.error('POST /api/admin/boards/bulk_upload error', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}


