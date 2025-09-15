import React, { useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { ThemedText } from './ThemedText';
import { ThemedView } from './ThemedView';
import { Direction } from '@/types/crossword';
import { formatTime } from '@/utils/crosswordUtils';
import { HEADER_BOTTOM_MARGIN, HEADER_TOP_MARGIN } from '@/constants/Margins';

interface CrosswordHeaderProps {
  elapsedTime: number;
  currentClue: string;
  direction: Direction;
  onRevealSquare?: () => void;
}

export function CrosswordHeader({ elapsedTime, currentClue, direction, onRevealSquare }: CrosswordHeaderProps) {
  const [confirmingReveal, setConfirmingReveal] = useState(false);
  const [rightColumnWidth, setRightColumnWidth] = useState<number | null>(null);
  const [smallHeaderMode, setSmallHeaderMode] = useState(false);

  useEffect(() => {
    if (!confirmingReveal) return;
    const timer = setTimeout(() => setConfirmingReveal(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmingReveal]);

  const handleHelpPress = () => {
    if (!confirmingReveal) {
      setConfirmingReveal(true);
      return;
    }
    // Second tap confirms reveal
    setConfirmingReveal(false);
    if (onRevealSquare) {
      onRevealSquare();
    }
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.topRow}>
        <View style={styles.leftColumn}>
          <ThemedText style={[
            styles.timer,
            { fontSize: smallHeaderMode ? 15 : 16 },
          ]}>
            {formatTime(elapsedTime)}
          </ThemedText>
        </View>
        <View style={styles.centerColumn}>
          <View style={styles.directionContainer}>
            <ThemedText style={[
              styles.directionText,
              { fontSize: smallHeaderMode ? 13 : 14 },
            ]}>
              {direction === 'across' ? '→' : '↓'} {direction.toUpperCase()}
            </ThemedText>
          </View>
        </View>
        <View
          style={styles.rightColumn}
          onLayout={(e) => setRightColumnWidth(e.nativeEvent.layout.width)}
        >
          <TouchableOpacity onPress={handleHelpPress} activeOpacity={0.7}>
            <ThemedText
              style={[
                styles.helpText,
                { fontSize: smallHeaderMode ? 15 : 16 },
                confirmingReveal && styles.helpConfirmText,
              ]}
            >
              {confirmingReveal ? 'Reveal square?' : 'Help'}
            </ThemedText>
          </TouchableOpacity>
          {rightColumnWidth != null && (
            <ThemedText
              style={[
                styles.measureText,
                { width: rightColumnWidth, fontSize: 16 },
              ]}
              onTextLayout={(e) => {
                const wraps = e.nativeEvent.lines.length > 1;
                setSmallHeaderMode(wraps);
              }}
            >
              {"Reveal square?"}
            </ThemedText>
          )}
        </View>
      </View>
      <View style={styles.clueContainer}>
        <ThemedText style={styles.clueText} numberOfLines={2}>
          {currentClue || 'Select a square to see the clue'}
        </ThemedText>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 8,
    marginTop: HEADER_TOP_MARGIN,
    marginBottom: HEADER_BOTTOM_MARGIN,
    borderRadius: 8,
    backgroundColor: '#f2f0f0',
    minHeight: 80,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  leftColumn: {
    flex: 1,
    alignItems: 'flex-start',
  },
  centerColumn: {
    flex: 1,
    alignItems: 'center',
  },
  rightColumn: {
    flex: 1,
    alignItems: 'flex-end',
  },
  timer: {
    fontWeight: '600',
    color: '#007AFF',
  },
  directionContainer: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 16,
  },
  directionText: {
    color: 'white',
    fontWeight: '600',
  },
  helpText: {
    fontWeight: '600',
    color: '#007AFF',
  },
  helpConfirmText: {
    color: '#b762d1',
  },
  measureText: {
    position: 'absolute',
    opacity: 0,
  },
  clueContainer: {
    flex: 1,
  },
  clueText: {
    fontSize: 18,
    color: '#333',
  },
});
