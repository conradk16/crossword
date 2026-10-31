import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/ThemedText';
import { CONTENT_BOTTOM_PADDING, SCROLL_CONTENT_HORIZONTAL_PADDING } from '@/constants/Margins';

// Mirrors the response of GET /api/puzzles/daily/leaderboard/weekly
export type WeeklyDayResult = {
  played: boolean;
  rank: number | null;
  of: number;
  score: number | null; // 1-100 relative to that day's fastest; null if not played or played solo
};

export type WeeklyPlayer = {
  username: string;
  isCurrentUser: boolean;
  days: WeeklyDayResult[];
  daysPlayed: number;
  scoredDays: number;
  avgScore: number | null;
  weeklyRank: number | null;
};

export type WeeklyLeaderboardData = {
  dates: string[]; // oldest -> newest, YYYY-MM-DD
  minScoredDaysToRank: number;
  players: WeeklyPlayer[];
};

// Single-hue blue ramp, light (slower) -> dark (faster). Validated as an ordinal ramp on a light surface.
const SPEED_RAMP = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'];
const SPEED_THRESHOLDS = [0, 55, 70, 85, 95];
const SOLO_FILL = '#c9c9c4';
const MISSED_BORDER = '#d0d0cc';
const TRACK = '#ececea';
const BAR = '#2a78d6';
const INK = '#333';
const MUTED = '#6b6b66';
const ACCENT = '#007AFF';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseIsoDate(iso: string): Date {
  // Dates are Pacific calendar days; read them as UTC so the device timezone can't shift the day
  return new Date(`${iso}T00:00:00Z`);
}

function weekdayLabel(iso: string): string {
  return WEEKDAYS[parseIsoDate(iso).getUTCDay()];
}

function longDateLabel(iso: string): string {
  const d = parseIsoDate(iso);
  return `${WEEKDAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

export function speedColor(score: number): string {
  let idx = 0;
  SPEED_THRESHOLDS.forEach((t, i) => { if (score >= t) idx = i; });
  return SPEED_RAMP[idx];
}

export function describeDay(player: WeeklyPlayer, date: string, day: WeeklyDayResult): string {
  const who = player.isCurrentUser ? 'You' : player.username;
  const when = longDateLabel(date);
  if (!day.played) return `${who} · ${when} · didn't play`;
  if (day.score == null) return `${who} · ${when} · played (no one else did)`;
  const place = day.rank === 1 ? 'fastest' : `${ordinal(day.rank ?? 0)} of ${day.of}`;
  return `${who} · ${when} · ${place}`;
}

type Selection = { username: string; dayIndex: number } | null;

export function WeeklyLeaderboard({ data }: { data: WeeklyLeaderboardData }) {
  const [selection, setSelection] = useState<Selection>(null);
  const { dates, players, minScoredDaysToRank } = data;
  const ranked = players.filter((p) => p.weeklyRank != null);
  const unranked = players.filter((p) => p.weeklyRank == null);
  const leaderRank = ranked.length ? ranked[0].weeklyRank : null;

  const selectedPlayer = selection ? players.find((p) => p.username === selection.username) : undefined;
  const caption = selectedPlayer && selection
    ? describeDay(selectedPlayer, dates[selection.dayIndex], selectedPlayer.days[selection.dayIndex])
    : 'Tap a square for details';

  if (players.length <= 1) {
    return (
      <View style={styles.centered}>
        <ThemedText style={styles.emptyTitle}>Add friends to compare your week!</ThemedText>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {/* Standings */}
      <ThemedText style={styles.sectionTitle}>Best this week</ThemedText>
      <ThemedText style={styles.sectionHint}>
        {"Average speed vs. the day's fastest (100 = fastest)"}
      </ThemedText>
      {ranked.length === 0 ? (
        <ThemedText style={styles.emptyNote}>
          No one has played {minScoredDaysToRank} days against friends yet this week.
        </ThemedText>
      ) : (
        ranked.map((p) => {
          const isLeader = p.weeklyRank === leaderRank;
          return (
            <View
              key={p.username}
              style={[styles.standingRow, p.isCurrentUser && styles.currentUserRow]}
              accessible
              accessibilityLabel={`${ordinal(p.weeklyRank!)}: ${p.isCurrentUser ? 'you' : p.username}, average ${p.avgScore}, played ${p.daysPlayed} of ${dates.length} days`}
            >
              <View style={styles.rankCol}>
                {isLeader ? (
                  <Ionicons name="trophy" size={18} color="#d4a017" />
                ) : (
                  <ThemedText style={[styles.rank, p.isCurrentUser && styles.currentUserText]}>{p.weeklyRank}</ThemedText>
                )}
              </View>
              <View style={styles.standingNameCol}>
                <ThemedText style={[styles.username, p.isCurrentUser && styles.currentUserText]} numberOfLines={1}>
                  {p.username}
                </ThemedText>
                <ThemedText style={styles.playedText}>played {p.daysPlayed}/{dates.length}</ThemedText>
              </View>
              <View style={styles.barCol}>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${p.avgScore ?? 0}%` }]} />
                </View>
                <ThemedText style={styles.barValue}>{p.avgScore}</ThemedText>
              </View>
            </View>
          );
        })
      )}
      {unranked.length > 0 && (
        <ThemedText style={styles.unrankedNote} numberOfLines={2}>
          Needs {minScoredDaysToRank}+ days vs. friends to rank: {unranked.map((p) => (p.isCurrentUser ? 'you' : p.username)).join(', ')}
        </ThemedText>
      )}

      {/* 7-day grid */}
      <ThemedText style={[styles.sectionTitle, styles.gridTitle]}>Last 7 days</ThemedText>
      <View style={styles.gridRow}>
        <View style={styles.gridNameCol} />
        {dates.map((d, i) => (
          <ThemedText key={d} style={styles.dayLabel}>
            {i === dates.length - 1 ? 'Today' : weekdayLabel(d)}
          </ThemedText>
        ))}
      </View>
      {players.map((p) => (
        <View key={p.username} style={styles.gridRow}>
          <ThemedText
            style={[styles.gridName, p.isCurrentUser && styles.currentUserGridName]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {p.username}
          </ThemedText>
          {p.days.map((day, i) => {
            const selected = selection?.username === p.username && selection.dayIndex === i;
            return (
              <Pressable
                key={dates[i]}
                style={styles.cellHit}
                hitSlop={4}
                onPress={() => setSelection(selected ? null : { username: p.username, dayIndex: i })}
                accessibilityRole="button"
                accessibilityLabel={describeDay(p, dates[i], day)}
                testID={`cell-${p.username}-${i}`}
              >
                <View
                  style={[
                    styles.cell,
                    !day.played && styles.cellMissed,
                    day.played && { backgroundColor: day.score == null ? SOLO_FILL : speedColor(day.score) },
                    selected && styles.cellSelected,
                  ]}
                />
              </Pressable>
            );
          })}
        </View>
      ))}
      <ThemedText style={styles.caption} testID="weekly-caption">{caption}</ThemedText>

      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendGroup}>
          <ThemedText style={styles.legendText}>Slower</ThemedText>
          {SPEED_RAMP.map((c) => <View key={c} style={[styles.legendSwatch, { backgroundColor: c }]} />)}
          <ThemedText style={styles.legendText}>Faster</ThemedText>
        </View>
        <View style={styles.legendGroup}>
          <View style={[styles.legendSwatch, { backgroundColor: SOLO_FILL }]} />
          <ThemedText style={styles.legendText}>Solo day</ThemedText>
          <View style={[styles.legendSwatch, styles.cellMissed, styles.legendSpacer]} />
          <ThemedText style={styles.legendText}>{"Didn't play"}</ThemedText>
        </View>
      </View>
    </ScrollView>
  );
}

const CELL_SIZE = 30;

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: SCROLL_CONTENT_HORIZONTAL_PADDING,
    paddingBottom: CONTENT_BOTTOM_PADDING + 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SCROLL_CONTENT_HORIZONTAL_PADDING,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: INK,
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
  gridTitle: {
    marginTop: 24,
    marginBottom: 6,
  },
  sectionHint: {
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
    marginBottom: 8,
  },
  emptyNote: {
    fontSize: 14,
    color: MUTED,
    paddingVertical: 8,
  },
  standingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#f9f9f9',
    marginBottom: 8,
  },
  currentUserRow: {
    backgroundColor: '#d4e9ff',
  },
  rankCol: {
    width: 32,
  },
  rank: {
    fontSize: 16,
    fontWeight: '700',
    color: INK,
  },
  standingNameCol: {
    width: 96,
    paddingRight: 8,
  },
  username: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
    color: INK,
  },
  currentUserText: {
    color: ACCENT,
  },
  playedText: {
    fontSize: 12,
    lineHeight: 16,
    color: MUTED,
  },
  barCol: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  barTrack: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    backgroundColor: TRACK,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: BAR,
  },
  barValue: {
    width: 32,
    textAlign: 'right',
    fontSize: 14,
    fontWeight: '600',
    color: INK,
  },
  unrankedNote: {
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
  },
  gridRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  gridNameCol: {
    width: 84,
  },
  gridName: {
    width: 84,
    paddingRight: 6,
    fontSize: 14,
    lineHeight: 18,
    color: INK,
  },
  currentUserGridName: {
    color: ACCENT,
    fontWeight: '700',
  },
  dayLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    lineHeight: 14,
    color: MUTED,
  },
  cellHit: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: 6,
  },
  cellMissed: {
    borderWidth: 1.5,
    borderColor: MISSED_BORDER,
    backgroundColor: 'transparent',
  },
  cellSelected: {
    borderWidth: 2,
    borderColor: '#11181C',
  },
  caption: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
    color: INK,
    textAlign: 'center',
  },
  legend: {
    marginTop: 14,
    gap: 8,
    alignItems: 'center',
  },
  legendGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendSwatch: {
    width: 14,
    height: 14,
    borderRadius: 3,
  },
  legendSpacer: {
    marginLeft: 10,
  },
  legendText: {
    fontSize: 12,
    lineHeight: 16,
    color: MUTED,
  },
});
