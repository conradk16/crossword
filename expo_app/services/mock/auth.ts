import { MockContext, parseBody, delay, buildJson } from './utils';

// Fixed mock auth constants
export const DEFAULT_USER_ID = 'user-abc-123';
export const DEFAULT_USER_EMAIL = 'you@example.com';
export const FIXED_AUTH_TOKEN = 'mock-fixed-token';

export type AuthUser = { id: string; email: string };

type AuthState = {
  usersByEmail: Map<string, AuthUser>;
  tokensToUserId: Map<string, string>;
  otpsByEmail: Map<string, { code: string; expiresAt: number }>;
  nextUserNum: number;
};

function getAuthState(): AuthState {
  const existing = (global as any).__AUTH_STATE__ as AuthState | undefined;
  if (existing) return existing;
  const state: AuthState = {
    usersByEmail: new Map<string, AuthUser>(),
    tokensToUserId: new Map<string, string>(),
    otpsByEmail: new Map<string, { code: string; expiresAt: number }>(),
    nextUserNum: 124,
  };
  const seeded: AuthUser = { id: DEFAULT_USER_ID, email: DEFAULT_USER_EMAIL };
  state.usersByEmail.set(seeded.email, seeded);
  state.tokensToUserId.set(FIXED_AUTH_TOKEN, seeded.id);
  (global as any).__AUTH_STATE__ = state;
  return state;
}

function findAuthUserById(id: string): AuthUser | null {
  const auth = getAuthState();
  for (const u of auth.usersByEmail.values()) {
    if (u.id === id) return u;
  }
  return null;
}

export async function handleAuthRoutes(ctx: MockContext): Promise<Response | null> {
  let { urlString, method, token } = ctx;
  const authState = getAuthState();

  // POST /api/auth/otp/send
  if (urlString === '/api/auth/otp/send' && method === 'POST') {
    await delay(300);
    const body = await parseBody<{ email?: string }>(ctx.options);
    const email = (body?.email || '').toLowerCase().trim();
    if (!email) return buildJson({ error: 'email required' }, 400);
    const code = '123456';
    const expiresAt = Date.now() + 5 * 60 * 1000;
    authState.otpsByEmail.set(email, { code, expiresAt });
    return buildJson({ message: 'An OTP has been sent to your email address. It will expire in 5 minutes.' }, 200);
  }

  // POST /api/auth/login
  if (urlString === '/api/auth/login' && method === 'POST') {
    await delay(300);
    const body = await parseBody<{ email?: string; otp?: string }>(ctx.options);
    const email = (body?.email || '').toLowerCase().trim();
    const otp = (body?.otp || '').trim();
    if (!email || !otp) return buildJson({ error: 'Missing fields.' }, 400);
    const pending = authState.otpsByEmail.get(email);
    if (!pending || pending.expiresAt < Date.now() || pending.code !== otp) {
      return buildJson({ error: 'Invalid or expired OTP.' }, 400);
    }
    let user = authState.usersByEmail.get(email);
    if (!user) {
      user = { id: `user-${authState.nextUserNum++}`, email };
      authState.usersByEmail.set(email, user);
    }
    authState.otpsByEmail.delete(email);
    const newToken = FIXED_AUTH_TOKEN;
    authState.tokensToUserId.set(newToken, user.id);
    return buildJson({ token: newToken, user }, 200);
  }

  // POST /api/auth/logout
  if (urlString === '/api/auth/logout' && method === 'POST') {
    await delay(200);
    if (token && authState.tokensToUserId.has(token)) {
      authState.tokensToUserId.delete(token);
    }
    return buildJson({ message: 'You have been successfully logged out.' }, 200);
  }

  return null;
}

export function getUserIdFromToken(token: string | null): string | null {
  const authState = getAuthState();
  if (!token) return null;
  return authState.tokensToUserId.get(token) || null;
}


