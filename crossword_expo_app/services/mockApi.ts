import { handlePuzzleRoutes } from './mock/puzzle';
import { handleAuthRoutes, getUserIdFromToken } from './mock/auth';
import { handleFriendsRoutes } from './mock/friends';
import { handleProfileRoutes } from './mock/profile';
import type { MockContext } from './mock/utils';

export function setupMockFetch() {
  if (__DEV__) {
    const originalFetch = global.fetch;
    
    global.fetch = async (url: string | URL | Request, options?: RequestInit) => {
      const urlString = url.toString();
      const method = (options?.method || 'GET').toUpperCase();
      const headers = (options?.headers || {}) as Record<string, string>;
      const authHeader = headers['Authorization'] || headers['authorization'] || '';
      const token = (authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '').trim();
      const userIdFromToken = getUserIdFromToken(token);
      const currentUserId = userIdFromToken || (authHeader.includes('Bearer') ? 'user-abc-123' : 'anonymous');
      const currentUsername = currentUserId === 'user-abc-123' ? 'you' : 'anon';

      const ctx: MockContext = {
        urlString,
        method,
        headers,
        options,
        token,
        authHeader,
        currentUserId,
        currentUsername,
        originalFetch,
      };

      const resPuzzle = await handlePuzzleRoutes(ctx);
      if (resPuzzle) return resPuzzle;
      const resAuth = await handleAuthRoutes(ctx);
      if (resAuth) return resAuth;
      const resProfile = await handleProfileRoutes(ctx);
      if (resProfile) return resProfile;
      const resFriends = await handleFriendsRoutes(ctx);
      if (resFriends) return resFriends;

      return originalFetch(url, options);
    };
  }
}
