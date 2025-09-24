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
      `SELECT u.username
       FROM users u
       WHERE u.username IS NOT NULL
         AND u.user_id <> $2
         AND lower(u.username) LIKE lower($1)
         AND NOT EXISTS (
           SELECT 1
           FROM friends f
           WHERE f.user_id = $2 AND f.friend_user_id = u.user_id
         )
       ORDER BY 
         CASE WHEN lower(u.username) = lower($3) THEN 0 ELSE 1 END,
         length(u.username) ASC,
         u.username ASC
       LIMIT 3`,
      [like, user.user_id, prefix]
    );

    // Return list of usernames only
    return NextResponse.json(rows.map(r => r.username));
  } catch (err) {
    console.error('GET /api/users/search error', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}


