import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { hashToken } from '@/lib/auth/utils';

export interface AuthenticatedUser {
  user_id: string;
  email: string;
  name: string | null;
  username: string | null;
}

export function extractBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return null;
  const lower = authHeader.toLowerCase();
  if (!lower.startsWith('bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
}

export async function requireAuthUser(req: NextRequest): Promise<AuthenticatedUser | null> {
  const token = extractBearerToken(req);
  if (!token) return null;
  const tokenHash = hashToken(token);

  // Join session to user to return profile fields
  const { rows } = await query<AuthenticatedUser & { token_hash: string }>(
    `SELECT u.user_id, u.email, u.name, u.username
     FROM user_sessions s
     JOIN users u ON u.user_id = s.user_id
     WHERE s.token_hash = $1`,
    [tokenHash]
  );

  if (rows.length === 0) return null;
  const { user_id, email, name, username } = rows[0];
  return { user_id, email, name, username };
}


