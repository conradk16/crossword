import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAuthUser } from '@/lib/auth/session';

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Delete the user - CASCADE foreign keys will automatically clean up:
    // - user_sessions (session tokens)
    // - friends (friendship relationships)
    // - friend_requests (friend requests as requester/recipient)
    // - puzzle_completions (puzzle completion records)
    const { rows } = await query<{ user_id: string; email: string }>(
      `DELETE FROM users WHERE user_id = $1 RETURNING user_id, email`,
      [user.user_id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const deletedUser = rows[0];
    console.log(`User account deleted: ${deletedUser.email} (${deletedUser.user_id})`);

    return NextResponse.json({ 
      success: true, 
      message: 'Account successfully deleted' 
    }, { status: 200 });

  } catch (err) {
    console.error('DELETE /api/delete error', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
