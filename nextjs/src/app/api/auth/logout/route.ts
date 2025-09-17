import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { hashToken } from '@/lib/auth/utils';

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return NextResponse.json({ error: 'Missing or invalid Authorization header' }, { status: 400 });
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    const tokenHash = hashToken(token);
    const { rows } = await query<{ user_id: string }>(
      `DELETE FROM user_sessions WHERE token_hash = $1 RETURNING user_id`,
      [tokenHash]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Token not found' }, { status: 401 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('Unexpected error in logout', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}


