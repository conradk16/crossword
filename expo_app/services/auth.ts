import { loadStoredAuthToken, saveStoredAuthToken, clearStoredAuthToken } from './storage';

// In-memory auth token cache
let authToken: string | null = null;
let hasLoadedFromStorage = false;

export async function getAuthToken(): Promise<string | null> {
  if (authToken) {
    return authToken;
  }
  if (!hasLoadedFromStorage) {
    try {
      authToken = await loadStoredAuthToken();
    } catch {
      authToken = null;
    } finally {
      hasLoadedFromStorage = true;
    }
  }
  return authToken;
}

export async function setAuthToken(token: string): Promise<void> {
  await saveStoredAuthToken(token);
  authToken = token;
}

export async function clearAuthToken(): Promise<void> {
  await clearStoredAuthToken();
  authToken = null;
}

export function isAuthenticated(): boolean {
  return authToken != null;
}


