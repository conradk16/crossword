import { validateAuthToken } from '../utils/authUtils';
import { withBaseUrl } from '@/constants/Api';
import { loadStoredAuthToken, saveStoredAuthToken, clearStoredAuthToken, loadPuzzleState, savePuzzleState } from './storage';

// Types
export type LeaderboardUser = {
  id: string;
  username: string;
};

export type LeaderboardEntry = {
  rank: number;
  user: LeaderboardUser;
  completionTime: number | null;
};

export type LeaderboardData = {
  date: string;
  leaderboard: LeaderboardEntry[];
};

export type Friend = {
  id: string;
  username: string;
};

export type FriendRequest = {
  requestId: string;
  fromUser: { id: string; username: string };
};

export type Profile = {
  id: string;
  email: string;
  username: string;
};

export type PuzzleCompletion = {
  date: string;
  completionTime: number | null;
};

// Internal state
type AppState = {
  // Auth state
  isAuthenticated: boolean; // false = not auth, true = auth
  authToken: string | null;
  
  // Leaderboard state
  leaderboard: LeaderboardData | null;
  
  // Friends state
  friends: Friend[];
  friendRequests: FriendRequest[];
  
  // Profile state
  profile: Profile | null;
  
  // Puzzle completion state
  puzzleCompletion: PuzzleCompletion | null;
  
  // Last sync timestamp
  lastSync: number | null;
};

// State management
let state: AppState = {
  isAuthenticated: false,
  authToken: null,
  leaderboard: null,
  friends: [],
  friendRequests: [],
  profile: null,
  puzzleCompletion: null,
  lastSync: null,
};

// Listeners for state changes
type StateListener = (state: AppState) => void;
const listeners = new Set<StateListener>();

// Subscribe to state changes
export function subscribeToState(listener: StateListener): () => void {
  listeners.add(listener);
  // Immediately call with current state
  listener(state);
  return () => listeners.delete(listener);
}

// Notify all listeners of state change
function notifyStateChange() {
  for (const listener of listeners) {
    listener({ ...state });
  }
}

// Update state helper
function updateState(updates: Partial<AppState>) {
  state = { ...state, ...updates };
  notifyStateChange();
}

// Auth token management
export async function getAuthToken(): Promise<string | null> {
  // If we have it in state, return it
  if (state.authToken) {
    return state.authToken;
  }
  
  // Otherwise load from storage and update state
  try {
    const token = await loadStoredAuthToken();
    if (token) {
      updateState({ authToken: token });
    }
    return token;
  } catch {
    return null;
  }
}

export async function setAuthToken(token: string): Promise<void> {
  await saveStoredAuthToken(token);
  updateState({ authToken: token, isAuthenticated: true });
}

export async function clearAuthToken(): Promise<void> {
  await clearStoredAuthToken();
  updateState({ 
    authToken: null, 
    isAuthenticated: false,
    profile: null,
    friends: [],
    friendRequests: [],
    leaderboard: null,
  });
}

// API helpers
async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = {
    ...options.headers,
    ...(state.authToken ? { Authorization: `Bearer ${state.authToken}` } : {}),
  };
  
  return fetch(url.startsWith('http') ? url : withBaseUrl(url), {
    ...options,
    headers,
  });
}

// Individual sync functions
async function syncAuth(): Promise<void> {
  try {
    // First load token from storage if not in state
    if (!state.authToken) {
      const token = await loadStoredAuthToken();
      if (token) {
        updateState({ authToken: token });
      }
    }
    
    const isValid = await validateAuthToken(state.authToken);
    updateState({ isAuthenticated: isValid });
    
    // If token is invalid, clear it
    if (!isValid) {
      await clearAuthToken();
    }
  } catch (error) {
    updateState({ isAuthenticated: false });
  }
}

async function syncLeaderboard(): Promise<void> {
  if (!state.isAuthenticated) {
    updateState({ leaderboard: null });
    return;
  }

  try {
    // Backend endpoint: GET /api/puzzles/daily/leaderboard -> [{ username, timeMs }]
    const response = await fetchWithAuth('/api/puzzles/daily/leaderboard');
    if (!response.ok) {
      return; // Silently fail, keep existing data
    }
    
    const rows: Array<{ username: string | null; timeMs: number | null }> = await response.json();
    const today = new Date().toISOString().split('T')[0];
    const leaderboard: LeaderboardData = {
      date: today,
      leaderboard: rows.map((r, idx) => ({
        rank: idx + 1,
        user: { id: r.username || `user-${idx + 1}`, username: r.username || '(unknown)' },
        completionTime: r.timeMs ?? null,
      })),
    };
    updateState({ leaderboard });
  } catch (error) {
    // Silently fail, keep existing data
  }
}

async function syncFriends(): Promise<void> {
  if (!state.isAuthenticated) {
    updateState({ 
      friends: [], 
      friendRequests: []
    });
    return;
  }

  try {
    // Fetch friends and friend requests in parallel
    const [friendsResponse, requestsResponse] = await Promise.all([
      fetchWithAuth('/api/friends'), // returns string[] of usernames
      fetchWithAuth('/api/friends/requests'), // returns string[] of requester usernames
    ]);
    
    if (!friendsResponse.ok || !requestsResponse.ok) {
      return; // Silently fail, keep existing data
    }
    
    const friendsUsernames: string[] = await friendsResponse.json();
    const incomingUsernames: string[] = await requestsResponse.json();
    updateState({
      friends: friendsUsernames.map((u) => ({ id: u, username: u })),
      friendRequests: incomingUsernames.map((u, i) => ({
        requestId: `req-${i + 1}-${u}`,
        fromUser: { id: u, username: u },
      })),
    });
  } catch (error) {
    // Silently fail, keep existing data
  }
}

async function syncProfile(): Promise<void> {
  if (!state.isAuthenticated) {
    updateState({ profile: null });
    return;
  }

  try {
    const response = await fetchWithAuth('/api/profile');
    if (!response.ok) {
      return; // Silently fail, keep existing data
    }
    
    const data: { user_id: string; email: string; name: string | null; username: string | null } = await response.json();
    const profile: Profile = { id: data.user_id, email: data.email, username: data.username || '' };
    updateState({ profile });
  } catch (error) {
    // Silently fail, keep existing data
  }
}

async function syncPuzzleCompletion(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  
  if (!state.isAuthenticated) {
    // If not authenticated, just load from local storage
    try {
      const stored = await loadPuzzleState(today);
      const completion: PuzzleCompletion = {
        date: today,
        completionTime: stored?.completionSeconds || null,
      };
      updateState({ puzzleCompletion: completion });
    } catch (error) {
      // Fallback to no completion data
      updateState({ puzzleCompletion: { date: today, completionTime: null } });
    }
    return;
  }

  try {
    // First, try to update server from local storage
    const stored = await loadPuzzleState(today);
    if (stored?.completionSeconds && stored.completionSeconds > 0) {
      try {
        await fetchWithAuth('/api/puzzles/daily/complete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            timeMs: Math.round((stored.completionSeconds || 0) * 1000),
          }),
        });
      } catch (error) {
        // Ignore server update errors - we'll get the truth from GET below
      }
    }

    // Now get the true value from server
    const response = await fetchWithAuth('/api/puzzles/daily/complete');
    if (response.ok) {
      const data: { completed: boolean; puzzleDate?: string; timeMs?: number } = await response.json();
      const completion: PuzzleCompletion = {
        date: data.puzzleDate || today,
        completionTime: data.completed ? Math.round((data.timeMs || 0) / 1000) : null,
      };
      
      // Update local storage with server truth
      if (completion.completionTime) {
        await savePuzzleState(completion.date, { completionSeconds: completion.completionTime });
      }
      
      // Update state
      updateState({ puzzleCompletion: completion });
    } else {
      // Fallback to local storage
      const completion: PuzzleCompletion = {
        date: today,
        completionTime: stored?.completionSeconds || null,
      };
      updateState({ puzzleCompletion: completion });
    }
  } catch (error) {
    // Fallback to local storage
    try {
      const stored = await loadPuzzleState(today);
      const completion: PuzzleCompletion = {
        date: today,
        completionTime: stored?.completionSeconds || null,
      };
      updateState({ puzzleCompletion: completion });
    } catch (storageError) {
      // Final fallback
      updateState({ puzzleCompletion: { date: today, completionTime: null } });
    }
  }
}

// Main sync function
export async function sync(): Promise<void> {  
  // Always sync auth first, as other syncs depend on it
  await syncAuth();
  
  // Sync all other data in parallel
  await Promise.all([
    syncLeaderboard(),
    syncFriends(),
    syncProfile(),
    syncPuzzleCompletion(),
  ]);
  
  updateState({ lastSync: Date.now() });
}

// Getter functions for components to use
export function getLeaderboardState() {
  return {
    data: state.leaderboard,
  };
}

export function getFriendsState() {
  return {
    friends: state.friends,
    friendRequests: state.friendRequests,
  };
}

export function getProfileState() {
  return {
    profile: state.profile,
  };
}

export function getAuthState() {
  return {
    isAuthenticated: state.isAuthenticated,
    token: state.authToken,
  };
}

export function getLastSyncTime() {
  return state.lastSync;
}

// Force refresh functions for individual sections
export async function refreshLeaderboard(): Promise<void> {
  await syncLeaderboard();
}

export async function refreshFriends(): Promise<void> {
  await syncFriends();
}

export async function refreshProfile(): Promise<void> {
  await syncProfile();
}

// Initialize state on app start
export async function initializeState(): Promise<void> {
  await sync();
}
