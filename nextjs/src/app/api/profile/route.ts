import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAuthUser } from '@/lib/auth/session';
import { isUsernameAllowed } from '@/lib/usernameFilter';

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({
      user_id: user.user_id,
      email: user.email,
      name: user.name,
      username: user.username,
    });
  } catch (err) {
    console.error('GET /api/profile error', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

type PatchBody = Partial<{
  name: string | null;
  username: string | null;
}>;

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as PatchBody;
    // Validate username if provided
    if (Object.prototype.hasOwnProperty.call(body, 'username')) {
      const username = body.username;
      if (typeof username === 'string') {
        if (username.length === 0) {
          return NextResponse.json({ error: 'Username cannot be empty' }, { status: 400 });
        }
        if (username.length > 15) {
          return NextResponse.json({ error: 'Username must be at most 15 characters' }, { status: 400 });
        }
        if (!/^[A-Za-z0-9]+$/.test(username)) {
          return NextResponse.json({ error: 'Username can only contain letters and numbers' }, { status: 400 });
        }
        if (!isUsernameAllowed(username)) {
          return NextResponse.json({ error: 'Username contains disallowed content' }, { status: 400 });
        }
      }
    }
    const fields: string[] = [];
    const values: unknown[] = [];

    if (Object.prototype.hasOwnProperty.call(body, 'name')) {
      fields.push('name');
      values.push(body.name === undefined ? null : body.name);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'username')) {
      fields.push('username');
      values.push(body.username === undefined ? null : body.username);
    }

    if (fields.length === 0) {
      return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
    }

    // Build dynamic SET clause safely
    const setClauses = fields.map((col, idx) => `${col} = $${idx + 1}`).join(', ');
    const params = [...values, user.user_id];

    // Perform update; return updated row
    const { rows } = await query<{ user_id: string; email: string; name: string | null; username: string | null }>(
      `UPDATE users SET ${setClauses}, updated_at = now() WHERE user_id = $${params.length} RETURNING user_id, email, name, username`,
      params
    );

    return NextResponse.json(rows[0], { status: 200 });
  } catch (err: unknown) {
    // Unique constraint on username
    const message = (err as Error)?.message || '';
    if (message.includes('users_username_key')) {
      return NextResponse.json({ error: 'Username already taken' }, { status: 409 });
    }
    console.error('PATCH /api/profile error', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}


