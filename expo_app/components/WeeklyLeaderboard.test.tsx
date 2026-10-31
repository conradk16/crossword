import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { describe, it, expect, jest } from '@jest/globals';

import { WeeklyLeaderboard, describeDay, speedColor, type WeeklyLeaderboardData, type WeeklyPlayer } from '@/components/WeeklyLeaderboard';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const DATES = ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'];
const played = (rank: number, of: number, score: number | null) => ({ played: true, rank, of, score });
const missed = (of: number) => ({ played: false, rank: null, of, score: null });

const ada: WeeklyPlayer = {
  username: 'ada', isCurrentUser: false, daysPlayed: 6, scoredDays: 5, avgScore: 81, weeklyRank: 1,
  days: [played(1, 3, 100), played(2, 2, 90), played(1, 1, null), played(1, 3, 100), played(3, 3, 56), played(2, 4, 59), missed(2)],
};
const me: WeeklyPlayer = {
  username: 'tester', isCurrentUser: true, daysPlayed: 6, scoredDays: 6, avgScore: 79, weeklyRank: 2,
  days: [played(2, 3, 83), played(1, 2, 100), missed(1), played(2, 3, 83), played(2, 3, 60), played(3, 4, 50), played(1, 2, 100)],
};
const cy: WeeklyPlayer = {
  username: 'cy', isCurrentUser: false, daysPlayed: 2, scoredDays: 2, avgScore: 100, weeklyRank: null,
  days: [missed(3), missed(2), missed(1), missed(3), played(1, 3, 100), played(1, 4, 100), missed(2)],
};
const DATA: WeeklyLeaderboardData = { dates: DATES, minScoredDaysToRank: 3, players: [ada, me, cy] };

describe('WeeklyLeaderboard', () => {
  it('ranks qualified players and lists the rest as unranked', () => {
    const { getByLabelText, getByText } = render(<WeeklyLeaderboard data={DATA} />);
    expect(getByLabelText('1st: ada, average 81, played 6 of 7 days')).toBeTruthy();
    expect(getByLabelText('2nd: you, average 79, played 6 of 7 days')).toBeTruthy();
    expect(getByText('Needs 3+ days vs. friends to rank: cy')).toBeTruthy();
  });

  it('shows placement, not times, when a cell is tapped', () => {
    const { getByTestId } = render(<WeeklyLeaderboard data={DATA} />);
    expect(getByTestId('weekly-caption').props.children).toBe('Tap a square for details');
    fireEvent.press(getByTestId('cell-tester-5'));
    expect(getByTestId('weekly-caption').props.children).toBe('You · Thu Oct 29 · 3rd of 4');
    fireEvent.press(getByTestId('cell-tester-5'));
    expect(getByTestId('weekly-caption').props.children).toBe('Tap a square for details');
  });

  it('prompts to add friends when alone', () => {
    const { getByText } = render(<WeeklyLeaderboard data={{ ...DATA, players: [me] }} />);
    expect(getByText('Add friends to compare your week!')).toBeTruthy();
  });
});

describe('describeDay', () => {
  it('covers fastest, missed and solo days', () => {
    expect(describeDay(ada, DATES[0], ada.days[0])).toBe('ada · Sat Oct 24 · fastest');
    expect(describeDay(ada, DATES[6], ada.days[6])).toBe("ada · Fri Oct 30 · didn't play");
    expect(describeDay(ada, DATES[2], ada.days[2])).toBe('ada · Mon Oct 26 · played (no one else did)');
  });
});

describe('speedColor', () => {
  it('gets darker as the score rises', () => {
    expect(speedColor(30)).toBe('#86b6ef');
    expect(speedColor(60)).toBe('#5598e7');
    expect(speedColor(100)).toBe('#104281');
  });
});
