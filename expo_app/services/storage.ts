import AsyncStorage from '@react-native-async-storage/async-storage';

export interface StoredPuzzleState {
  date: string;
  letters?: (string | null)[][];
  completionSeconds?: number;
  elapsedSeconds?: number;
  hasStarted?: boolean;
}

const STORAGE_KEY_PREFIX = 'puzzleState:';
const AUTH_TOKEN_KEY = 'authToken';

function buildStorageKey(date: string): string {
  return `${STORAGE_KEY_PREFIX}${date}`;
}

async function readState(date: string): Promise<StoredPuzzleState | null> {
  try {
    const raw = await AsyncStorage.getItem(buildStorageKey(date));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPuzzleState;
    if (parsed && parsed.date === date) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

async function writeState(date: string, state: StoredPuzzleState): Promise<void> {
  try {
    const key = buildStorageKey(date);
    await AsyncStorage.setItem(key, JSON.stringify(state));
  } catch {
    // ignore write errors
  }
}

export async function loadPuzzleState(date: string): Promise<StoredPuzzleState | null> {
  return readState(date);
}

export async function savePuzzleState(
  date: string,
  partial: Partial<Omit<StoredPuzzleState, 'date'>>
): Promise<void> {
  try {
    const key = buildStorageKey(date);
    await AsyncStorage.mergeItem(key, JSON.stringify({ date, ...partial }));
  } catch {
    // ignore write errors
  }
}

export async function saveElapsedSeconds(date: string, elapsedSeconds: number): Promise<void> {
  try {
    const key = buildStorageKey(date);
    await AsyncStorage.mergeItem(key, JSON.stringify({ date, elapsedSeconds }));
  } catch {
    // ignore write errors
  }
}

export async function loadStoredAuthToken(): Promise<string | null> {
  try {
    const token = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
    return token || null;
  } catch {
    return null;
  }
}

export async function saveStoredAuthToken(token: string): Promise<void> {
  try {
    await AsyncStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {
  }
}

export async function clearStoredAuthToken(): Promise<void> {
  try {
    await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
  }
}


