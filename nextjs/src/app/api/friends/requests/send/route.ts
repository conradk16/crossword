import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/db';
import { requireAuthUser } from '@/lib/auth/session';

type SendRequestBody = {
  username: string;
};

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as Partial<SendRequestBody>;
    const username = (body.username || '').trim();
    if (!username) {
      return NextResponse.json({ error: 'username is required' }, { status: 400 });
    }

    // Resolve username to user_id
    const { rows: recipientRows } = await query<{ user_id: string }>(
      'SELECT user_id FROM users WHERE username = $1',
      [username]
    );

    if (recipientRows.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const recipientUserId = recipientRows[0].user_id;
    if (recipientUserId === user.user_id) {
      return NextResponse.json({ error: 'Cannot send a friend request to yourself' }, { status: 400 });
    }

    // Check if already friends
    const { rows: friendRows } = await query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM friends WHERE user_id = $1 AND friend_user_id = $2) as exists',
      [user.user_id, recipientUserId]
    );
    if (friendRows[0]?.exists) {
      return NextResponse.json({ error: 'Already friends' }, { status: 409 });
    }

    // Upsert friend request: if one exists in either direction
    // - If recipient already sent to requester and it's pending, accept both and create friendship
    // - Else, create (or do nothing if duplicate) a pending request requester -> recipient
    await withTransaction(async (client) => {
      // Check inverse pending request
      const inverse = await client.query<{ id: number; status: string }>(
        'SELECT id, status FROM friend_requests WHERE requester_user_id = $1 AND recipient_user_id = $2',
        [recipientUserId, user.user_id]
      );

      if (inverse.rows.length > 0 && inverse.rows[0].status === 'pending') {
        // Accept both ways: mark accepted and create friendship edges if not exist
        await client.query('UPDATE friend_requests SET status = $1, responded_at = now() WHERE id = $2', [
          'accepted',
          inverse.rows[0].id,
        ]);

        // Create directed edges (ignore conflicts)
        await client.query(
          'INSERT INTO friends (user_id, friend_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [user.user_id, recipientUserId]
        );
        await client.query(
          'INSERT INTO friends (user_id, friend_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [recipientUserId, user.user_id]
        );

        return { matchedExisting: true, createdRequestId: null as number | null, autoAccepted: true };
      }

      // Otherwise, insert or update existing same-direction request
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO friend_requests (requester_user_id, recipient_user_id, status)
         VALUES ($1, $2, 'pending')
         ON CONFLICT (requester_user_id, recipient_user_id)
         DO UPDATE SET status = EXCLUDED.status, created_at = now(), responded_at = NULL
         RETURNING id`,
        [user.user_id, recipientUserId]
      );

      return { matchedExisting: false, createdRequestId: inserted.rows[0].id, autoAccepted: false };
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    const message = (err as Error)?.message || '';
    if (message.includes('users_username_key')) {
      return NextResponse.json({ error: 'Invalid username' }, { status: 400 });
    }
    if (message.includes('uq_friend_requests_pair')) {
      // Treat as success when a request already exists
      return NextResponse.json({ success: true }, { status: 200 });
    }
    console.error('POST /api/friends/requests/send error', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}


