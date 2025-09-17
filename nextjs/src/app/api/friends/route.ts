import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAuthUser } from '@/lib/auth/session';

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { rows } = await query<{ username: string }>(
      `SELECT u.username
       FROM friends f
       JOIN users u ON u.user_id = f.friend_user_id
       WHERE f.user_id = $1 AND u.username IS NOT NULL
       ORDER BY u.username ASC`,
      [user.user_id]
    );

    return NextResponse.json(rows.map(r => r.username));
  } catch (err) {
    console.error('GET /api/friends error', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}


