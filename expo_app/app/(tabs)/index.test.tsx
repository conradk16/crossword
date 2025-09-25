import { render, waitFor, act } from '@testing-library/react-native';
import { jest, describe, it, beforeEach, expect } from '@jest/globals';

jest.useFakeTimers();

// Mock navigation focus to allow triggering focus multiple times
let triggerFocus: () => void;
jest.mock('@react-navigation/native', () => {
  let cleanup: (() => void) | null = null;
  let callback: (() => void | (() => void)) | null = null;
  triggerFocus = () => {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
    if (callback) {
      const maybeCleanup = callback();
      cleanup = (typeof maybeCleanup === 'function') ? maybeCleanup : null;
    }
  };
  return {
    useFocusEffect: (cb: any) => {
      // Register the callback but DO NOT invoke during render.
      // Tests should call triggerFocus() to simulate focus.
      callback = cb;
    },
  };
});

// Safe area
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: any) => children,
}));


// Minimal mocks for contexts used by the screen
jest.mock('@/services/AuthContext', () => ({
  useAuth: () => ({ token: 'token', syncAuth: jest.fn() }),
}));
jest.mock('@/services/FriendRequestCountContext', () => ({
  useFriendRequestCount: () => ({ syncFriendRequestCount: jest.fn() }),
}));

// Mock API base URL helper
jest.mock('@/constants/Api', () => ({
  withBaseUrl: (path: string) => path,
}));

// Storage mocks to control restored elapsed time
const mockLoadPuzzleState = jest.fn();
const mockSavePuzzleState = jest.fn();
const mockSaveElapsedSeconds = jest.fn();
jest.mock('@/services/storage', () => ({
  loadPuzzleState: (...args: any[]) => mockLoadPuzzleState(...args),
  savePuzzleState: (...args: any[]) => mockSavePuzzleState(...args),
  saveElapsedSeconds: (...args: any[]) => mockSaveElapsedSeconds(...args),
}));

// Expo modules used inside the screen
jest.mock('expo-blur', () => ({
  BlurView: ({ children }: any) => children,
}));
jest.mock('expo-av', () => ({
  Audio: {
    Sound: {
      createAsync: jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue({
          sound: {
            playAsync: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
            unloadAsync: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
            setOnPlaybackStatusUpdate: jest.fn(),
          },
        }),
    },
    setAudioModeAsync: jest
      .fn<(...args: any[]) => Promise<void>>()
      .mockResolvedValue(undefined),
  },
  InterruptionModeAndroid: { DuckOthers: 1 },
}) as any);

// Mock global fetch to deliver two different dates across calls
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// Import after mocks so the component uses them
import CrosswordScreen from './index';

function makePuzzle(date: string) {
  return {
    date,
    grid: [
      ['a', 'b'],
      ['c', null],
    ],
    clues: [
      { clue: 'Across 1', direction: 'across', row: 0, col: 0, length: 2 },
      { clue: 'Down 1', direction: 'down', row: 0, col: 0, length: 2 },
    ],
  };
}

describe('CrosswordScreen - date change refresh and timer behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('continues timer after date change instead of sticking at 00:00', async () => {
    // First load: date D1, no saved state
    mockLoadPuzzleState.mockImplementationOnce(async () => undefined);
    mockFetch.mockImplementationOnce(async () => ({
      ok: true,
      json: async () => makePuzzle('2025-01-01'),
    }));

    const { getByText, queryByText } = render(<CrosswordScreen />);

    // Simulate initial focus so the effect runs
    triggerFocus();

    // Allow initial load to complete and content to render
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getByText('Across 1')).toBeTruthy());
    // Timer starts at 00:00 then increments
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    // Expect a time like 00:03 to be rendered
    await waitFor(() => {
      expect(getByText('00:03')).toBeTruthy();
    });

    // Prepare second load: new date D2 with restored elapsed seconds = 7
    mockLoadPuzzleState.mockImplementationOnce(async () => ({ elapsedSeconds: 7 }));
    mockFetch.mockImplementationOnce(async () => ({
      ok: true,
      json: async () => makePuzzle('2025-01-02'),
    }));

    // Simulate focus again (e.g., user returns to app after midnight)
    triggerFocus();

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

    // After date change, timer should use restored 7 seconds and continue
    // Advance the timer by 2s => expect 00:09
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    await waitFor(() => {
      expect(getByText('00:09')).toBeTruthy();
      // Ensure it did not remain stuck at 00:00
      expect(queryByText('00:00')).toBeNull();
    });
  });
});



