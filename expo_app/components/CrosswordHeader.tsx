import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { Colors } from '@/constants/Colors';
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
  onRevealPuzzle?: () => void;
  isCompleted?: boolean;
  isHelpMenuOpen?: boolean;
  onOpenHelpMenu?: (anchor: { x: number; y: number; width: number; height: number }) => void;
}

export function CrosswordHeader({ elapsedTime, currentClue, direction, onRevealSquare, onRevealPuzzle, isCompleted, isHelpMenuOpen, onOpenHelpMenu }: CrosswordHeaderProps) {
  const [rightColumnWidth, setRightColumnWidth] = useState<number | null>(null);
  const [smallHeaderMode, setSmallHeaderMode] = useState(false);
  const [clueMode, setClueMode] = useState<'default' | 'small' | 'twoLine'>('default');
  const [clueContainerWidth, setClueContainerWidth] = useState<number | null>(null);
  const helpAnchorRef = useRef<View | null>(null);

  // Reset clue size mode when the clue text changes so we can re-measure
  useEffect(() => {
    setClueMode('default');
  }, [currentClue]);

  const handleHelpPress = () => {
    try {
      helpAnchorRef.current?.measureInWindow?.((x, y, width, height) => {
        onOpenHelpMenu?.({ x, y, width, height });
      });
    } catch {
      const windowWidth = Dimensions.get('window').width;
      onOpenHelpMenu?.({ x: windowWidth - 100, y: 44, width: 88, height: 28 });
    }
  };

  const handleSelectRevealSquare = () => {
    if (onRevealSquare) onRevealSquare();
  };

  const handleSelectRevealPuzzle = () => {
    if (onRevealPuzzle) onRevealPuzzle();
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
          <View ref={helpAnchorRef}>
            <TouchableOpacity onPress={handleHelpPress} activeOpacity={0.7}>
              <ThemedText
                style={[
                  styles.helpText,
                  { fontSize: smallHeaderMode ? 15 : 16 },
                ]}
              >
                {'Help'}
              </ThemedText>
            </TouchableOpacity>
          </View>
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
              {"Reveal puzzle"}
            </ThemedText>
          )}
        </View>
      </View>
      <View style={styles.clueContainer} onLayout={(e) => setClueContainerWidth(e.nativeEvent.layout.width)}>
        <ThemedText
          style={[styles.clueText, (clueMode !== 'default') && styles.clueTextTwoLine]}
          numberOfLines={clueMode === 'twoLine' ? 2 : 1}
        >
          {currentClue || 'Select a square to see the clue'}
        </ThemedText>
        {clueContainerWidth != null && clueMode === 'default' && (
          <ThemedText
            style={[styles.measureText, { width: clueContainerWidth, fontSize: 18, lineHeight: 22 }]}
            onTextLayout={(e) => {
              const wraps = e.nativeEvent.lines.length > 1;
              if (wraps) {
                setClueMode('small');
              }
            }}
          >
            {currentClue || 'Select a square to see the clue'}
          </ThemedText>
        )}
        {clueContainerWidth != null && clueMode === 'small' && (
          <ThemedText
            style={[styles.measureText, { width: clueContainerWidth, fontSize: 16, lineHeight: 18 }]}
            onTextLayout={(e) => {
              const wraps = e.nativeEvent.lines.length > 1;
              if (wraps) {
                setClueMode('twoLine');
              }
            }}
          >
            {currentClue || 'Select a square to see the clue'}
          </ThemedText>
        )}
      </View>

      {/* Menu is rendered by parent overlay to avoid dismissing keyboard */}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 85,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.light.surfaceHeader,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
    paddingHorizontal: 10,
    paddingVertical: 0,
    borderRadius: 14,
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
    color: '#007AFF',
  },
  measureText: {
    position: 'absolute',
    display: 'none',
  },
  clueContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  clueText: {
    fontSize: 18,
    lineHeight: 22,
    color: '#333',
  },
  clueTextTwoLine: {
    fontSize: 16,
    lineHeight: 18,
  },
  menuRoot: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
  menuBackdrop: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'transparent',
  },
  menuContainer: {
    position: 'absolute',
    top: 44,
    right: 12,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 6,
    width: 180,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e6e6e6',
  },
  menuItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  menuItemText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E5E5EA',
    marginVertical: 2,
  },
});
