import { CrosswordData } from '@/types/crossword';
import { MockContext, delay, buildJson } from './utils';

interface CompletionRecord {
  userId: string;
  date: string;
  completionTime: number;
  rank: number;
}

// In-memory storage for completion records
const completionRecords: { [key: string]: CompletionRecord } = {};

const mockPuzzleData: CrosswordData = {
  date: '2025-09-02',
  grid: [
    ['S', 'A', 'V', 'E', 'R'],
    ['O', null, 'I', null, 'E'],
    ['L', 'I', 'N', 'E', 'S'],
    ['A', null, 'Y', null, 'T'],
    ['R', 'E', 'S', 'T', 'S'],
  ],
  clues: [
    { clue: 'One who puts money aside ', direction: 'across', row: 0, col: 0, length: 5 },
    { clue: 'Rows of words', direction: 'across', row: 2, col: 0, length: 5 },
    { clue: 'Places to sleep', direction: 'across', row: 4, col: 0, length: 5 },
    { clue: 'Relating to the sun', direction: 'down', row: 0, col: 0, length: 5 },
    { clue: 'Record material', direction: 'down', row: 0, col: 2, length: 5 },
    { clue: 'Breaks from work', direction: 'down', row: 0, col: 4, length: 5 },
  ],
};

export async function handlePuzzleRoutes(ctx: MockContext): Promise<Response | null> {
  const { urlString, method, currentUserId, options } = ctx;

  if (urlString.includes('/api/puzzles/daily/complete') && method === 'POST') {
    await delay(300);
    
    if (!ctx.token) {
      return buildJson({ error: 'Authentication required' }, 401);
    }

    const body = options?.body ? JSON.parse(options.body as string) : {};
    const completionTime = body.completionTime;
    const puzzleDate = body.date;
    
    if (!completionTime || typeof completionTime !== 'number') {
      return buildJson({ error: 'Invalid completion time' }, 400);
    }

    if (!puzzleDate) {
      return buildJson({ error: 'Puzzle date is required' }, 400);
    }

    const recordKey = `${currentUserId}-${puzzleDate}`;
    
    // Check if already submitted
    if (completionRecords[recordKey]) {
      return buildJson({ error: 'You have already submitted a score for this puzzle.' }, 409);
    }

    // Calculate rank (simplified - just count how many existing records are faster for this date)
    const existingRecords = Object.values(completionRecords).filter(r => r.date === puzzleDate);
    const rank = existingRecords.filter(r => r.completionTime < completionTime).length + 1;

    // Store the completion record
    const completion: CompletionRecord = {
      userId: currentUserId,
      date: puzzleDate,
      completionTime,
      rank,
    };
    
    completionRecords[recordKey] = completion;

    return buildJson({
      message: 'Completion time recorded successfully.',
      completion,
    }, 201);
  }

  if (urlString.includes('/api/puzzles/daily/complete') && method === 'GET') {
    await delay(300);
    
    if (!ctx.token) {
      return buildJson({ error: 'Authentication required' }, 401);
    }

    const today = new Date().toISOString().split('T')[0];
    const recordKey = `${currentUserId}-${today}`;
    
    // Find the user's completion record for today
    const completion = completionRecords[recordKey];
    
    if (completion) {
      return buildJson({
        date: completion.date,
        completionTime: completion.completionTime,
      }, 200);
    } else {
      // User hasn't completed today's puzzle
      return buildJson({
        date: today,
        completionTime: null,
      }, 200);
    }
  }

  if (urlString.includes('/api/puzzles/daily') && method === 'GET') {
    await delay(500);
    return new Response(JSON.stringify(mockPuzzleData), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (urlString.includes('/api/leaderboard/daily')) {
    await delay(500);
    const mockLeaderboard = {
      date: '2025-09-02',
      leaderboard: [
        { rank: 1, user: { id: 'user-jkl-345', username: 'puzzler_pal' }, completionTime: 188 },
        { rank: 2, user: { id: 'user-abc-123', username: 'you' }, completionTime: 245 },
        { rank: 3, user: { id: 'user-ghi-012', username: 'best_friend' }, completionTime: 312 },
        { rank: 4, user: { id: 'user-xyz-999', username: 'slowpoke' }, completionTime: null as unknown as number },
      ],
    };
    return buildJson(mockLeaderboard, 200);
  }

  return null;
}


