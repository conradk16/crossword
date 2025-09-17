import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAuthUser } from '@/lib/auth/session';

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use index: idx_friend_requests_recipient_status_created_at
    const { rows } = await query<{ username: string }>(
      `SELECT u.username
       FROM friend_requests fr
       JOIN users u ON u.user_id = fr.requester_user_id
       WHERE fr.recipient_user_id = $1 AND fr.status = 'pending'
       ORDER BY fr.created_at DESC
       LIMIT 50`,
      [user.user_id]
    );

    // Return list of usernames
    return NextResponse.json(rows.map(r => r.username));
  } catch (err) {
    console.error('GET /api/friends/requests error', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}


