import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/db';
import { requireAuthUser } from '@/lib/auth/session';

type RespondBody = {
  action: 'accept' | 'reject';
  username: string;
};

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as Partial<RespondBody>;
    const action = body.action;
    if (action !== 'accept' && action !== 'reject') {
      return NextResponse.json({ error: "action must be 'accept' or 'reject'" }, { status: 400 });
    }

    const requesterUsername = (body.username || '').trim();
    if (!requesterUsername) {
      return NextResponse.json({ error: 'username is required' }, { status: 400 });
    }

    // Fetch the latest pending request targeting the current user from this username
    const { rows } = await query<{
      id: number;
      requester_user_id: string;
      recipient_user_id: string;
      status: string;
    }>(
      `SELECT fr.id, fr.requester_user_id, fr.recipient_user_id, fr.status
       FROM friend_requests fr
       JOIN users u ON u.user_id = fr.requester_user_id
       WHERE fr.recipient_user_id = $1 AND u.username = $2 AND fr.status = 'pending'
       ORDER BY fr.created_at DESC
       LIMIT 1`,
      [user.user_id, requesterUsername]
    );
    const requestRow: { id: number; requester_user_id: string; recipient_user_id: string; status: string } | null =
      rows[0] || null;

    if (!requestRow) {
      return NextResponse.json({ error: 'Friend request not found' }, { status: 404 });
    }

    if (action === 'accept') {
      const result = await withTransaction(async (client) => {
        // Mark accepted if still pending
        await client.query(
          'UPDATE friend_requests SET status = $1, responded_at = now() WHERE id = $2 AND status = $3',
          ['accepted', requestRow!.id, 'pending']
        );

        // Create mutual friendship edges idempotently
        await client.query(
          'INSERT INTO friends (user_id, friend_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [requestRow!.requester_user_id, requestRow!.recipient_user_id]
        );
        await client.query(
          'INSERT INTO friends (user_id, friend_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [requestRow!.recipient_user_id, requestRow!.requester_user_id]
        );

        return { accepted: true } as const;
      });
      return NextResponse.json({ success: true, ...result }, { status: 200 });
    }

    // action === 'reject'
    await withTransaction(async (client) => {
      await client.query(
        'UPDATE friend_requests SET status = $1, responded_at = now() WHERE id = $2 AND status = $3',
        ['rejected', requestRow!.id, 'pending']
      );
    });
    return NextResponse.json({ success: true, rejected: true }, { status: 200 });
  } catch (err) {
    console.error('POST /api/friends/requests/respond error', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}


