import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAuthUser } from '@/lib/auth/session';

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const prefix = (searchParams.get('prefix') || '').trim();
    if (!prefix) {
      return NextResponse.json({ error: 'prefix is required' }, { status: 400 });
    }

    // Case-insensitive prefix match using functional index on lower(username)
    const like = prefix.replace(/[%_]/g, '\\$&') + '%';
    const { rows } = await query<{ username: string }>(
      `SELECT username
       FROM users
       WHERE username IS NOT NULL AND lower(username) LIKE lower($1)
       ORDER BY username ASC
       LIMIT 10`,
      [like]
    );

    // Return list of usernames only
    return NextResponse.json(rows.map(r => r.username));
  } catch (err) {
    console.error('GET /api/users/search error', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}


