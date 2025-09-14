import { MockContext, delay, buildJson, parseBody } from './utils';

// Profile constants matching auth defaults
const DEFAULT_USER_ID = 'user-abc-123';
const DEFAULT_USER_EMAIL = 'you@example.com';
const DEFAULT_USERNAME = '';
const FIXED_AUTH_TOKEN = 'mock-fixed-token';

export type Profile = {
  id: string;
  email: string;
  username: string;
};

type ProfileState = {
  tokenToProfile: Map<string, Profile>;
};

function getProfileState(): ProfileState {
  const existing = (global as any).__PROFILE_STATE__ as ProfileState | undefined;
  if (existing) return existing;
  
  const state: ProfileState = {
    tokenToProfile: new Map<string, Profile>(),
  };
  
  // Initialize with default profile
  const defaultProfile: Profile = {
    id: DEFAULT_USER_ID,
    email: DEFAULT_USER_EMAIL,
    username: DEFAULT_USERNAME,
  };
  state.tokenToProfile.set(FIXED_AUTH_TOKEN, defaultProfile);
  
  (global as any).__PROFILE_STATE__ = state;
  return state;
}

export async function handleProfileRoutes(ctx: MockContext): Promise<Response | null> {
  let { urlString, method, token } = ctx;
  const profileState = getProfileState();

  // GET /api/profile
  if (urlString === '/api/profile' && method === 'GET') {
    await delay(200);
    if (!token || !profileState.tokenToProfile.has(token)) {
      return buildJson({ error: 'You are not authorized to access this resource.' }, 401);
    }
    const profile = profileState.tokenToProfile.get(token)!;
    return buildJson(profile, 200);
  }

  // PUT /api/profile
  if (urlString === '/api/profile' && method === 'PUT') {
    await delay(300);
    if (!token || !profileState.tokenToProfile.has(token)) {
      return buildJson({ error: 'You are not authorized to access this resource.' }, 401);
    }
    
    const body = await parseBody<{ username?: string }>(ctx.options);
    if (!body || !body.username) {
      return buildJson({ error: 'Username is required' }, 400);
    }
    
    const username = body.username.trim();
    if (!username) {
      return buildJson({ error: 'Username cannot be empty' }, 400);
    }
    
    // Basic username validation
    if (username.length < 2 || username.length > 20) {
      return buildJson({ error: 'Username must be between 2 and 20 characters' }, 400);
    }
    
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return buildJson({ error: 'Username can only contain letters, numbers, and underscores' }, 400);
    }
    
    const profile = profileState.tokenToProfile.get(token)!;
    profile.username = username;
    
    return buildJson(profile, 200);
  }

  return null;
}
