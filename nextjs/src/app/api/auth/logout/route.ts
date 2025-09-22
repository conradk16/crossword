import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { hashToken } from '@/lib/auth/utils';
import crypto from 'crypto';

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
	// Instead of deleting the session row (which erases the last successful login timestamp),
	// replace the token hash with a random value so the bearer token becomes invalid while
	// preserving the row's created_at for rate-limiting logic that references last login.
	const replacementHash = hashToken(crypto.randomBytes(32).toString('hex'));
	const { rows } = await query<{ user_id: string }>(
	  `UPDATE user_sessions SET token_hash = $2 WHERE token_hash = $1 RETURNING user_id`,
	  [tokenHash, replacementHash]
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


