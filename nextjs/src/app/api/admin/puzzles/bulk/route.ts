import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// POST /api/admin/puzzles/bulk
// Accepts NDJSON (one JSON object per line) with shape:
// { "puzzle_date": "YYYY-MM-DD", "data": { grid: (string|null)[][], clues: [...] } }
// Upserts rows into puzzles table by puzzle_date.
export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get('x-admin-secret');
    if (!secret || secret !== process.env.CROSSWORD_ADMIN_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const text = await req.text();
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    type Item = { puzzle_date: string; data: unknown };
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
      if (!rec.puzzle_date || !rec.data) {
        return NextResponse.json({ error: `Missing fields on line ${i + 1}` }, { status: 400 });
      }
      // naive ISO date validation
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.puzzle_date)) {
        return NextResponse.json({ error: `Invalid puzzle_date on line ${i + 1}` }, { status: 400 });
      }
      items.push({ puzzle_date: rec.puzzle_date, data: rec.data });
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
      if (items[i].puzzle_date < pacificToday) {
        return NextResponse.json(
          { error: `puzzle_date on line ${i + 1} must be later than Pacific today (${pacificToday})` },
          { status: 400 }
        );
      }
    }

    if (items.length === 0) {
      return NextResponse.json({ upserted: 0 });
    }

    const valuesSql = items.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
    const params = items.flatMap(r => [r.puzzle_date, r.data]);

    await query(
      `INSERT INTO puzzles (puzzle_date, data)
       VALUES ${valuesSql}
       ON CONFLICT (puzzle_date) DO UPDATE SET data = EXCLUDED.data`,
      params
    );

    return NextResponse.json({ upserted: items.length });
  } catch (err) {
    console.error('POST /api/admin/puzzles/bulk error', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}


