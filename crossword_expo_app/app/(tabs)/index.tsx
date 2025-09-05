import React, { useState, useEffect, useCallback, useRef } from 'react';
import { StyleSheet, ScrollView, KeyboardAvoidingView, Platform, TextInput, Dimensions, View, Pressable, Keyboard, useWindowDimensions, Modal, AppState } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { Audio } from 'expo-av';
import { loadPuzzleState, savePuzzleState } from '@/services/storage';
import { getAuthToken, initializeState, sync } from '@/services/state';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { CrosswordGrid } from '@/components/CrosswordGrid';
import { CrosswordHeader } from '@/components/CrosswordHeader';
import { SCROLL_CONTENT_HORIZONTAL_PADDING, CONTENT_BOTTOM_PADDING } from '@/constants/Margins';

import { CrosswordData, CrosswordCell, Direction, GameState } from '@/types/crossword';
import { convertGridToCells, findWordForPosition, isPuzzleComplete, findNextBlankSpotInDirectionAfter, findNextClueStartInDirectionAfter, findFirstEmptySpotInDirection, getNextCellInWord, formatTime, hasAnyEmptyCells, getFirstClueStartInDirection } from '@/utils/crosswordUtils';

export default function CrosswordScreen() {
  const [puzzleData, setPuzzleData] = useState<CrosswordData | null>(null);
  const [grid, setGrid] = useState<CrosswordCell[][]>([]);
  const [gameState, setGameState] = useState<GameState>({
    selectedRow: 0,
    selectedCol: 0,
    direction: 'across',
    currentWord: null,
    startTime: Date.now(),
    elapsedTime: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const textInputRef = useRef<TextInput>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [isPuzzleSolved, setIsPuzzleSolved] = useState(false);
  const [shouldRefocus, setShouldRefocus] = useState(true);
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [isTimerPaused, setIsTimerPaused] = useState(false);
  const [isAppInBackground, setIsAppInBackground] = useState(false);
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const [stickyKeyboardHeight, setStickyKeyboardHeight] = useState(0);

  // Function to play bell sound when puzzle is completed
  const playBellSound = useCallback(async () => {
    try {
      const { sound } = await Audio.Sound.createAsync(
        require('../../assets/sounds/bell.mp3')
      );
      
      await sound.playAsync();
      
      // Unload the sound from memory after it finishes playing
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync();
        }
      });
    } catch (error) {
      console.log('Error playing bell sound:', error);
    }
  }, []);

  // Track the largest keyboard height seen this session and keep reserving it
  useEffect(() => {
    const handleKeyboardEvent = (e: any) => {
      const nextHeight = e?.endCoordinates?.height ?? 0;
      if (nextHeight > 0) {
        setStickyKeyboardHeight(prev => Math.max(prev, nextHeight));
      }
    };

    const subWillChange = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow',
      handleKeyboardEvent
    );
    const subDidShow = Keyboard.addListener('keyboardDidShow', handleKeyboardEvent);

    return () => {
      subWillChange.remove();
      subDidShow.remove();
    };
  }, []);

  // Listen for app background/foreground transitions to pause/resume timer
  useEffect(() => {
    const handleAppStateChange = (nextAppState: string) => {
      const isBackground = nextAppState === 'background' || nextAppState === 'inactive';
      setIsAppInBackground(isBackground);

      if (isPuzzleSolved) {
        return; // Don't change timer state if puzzle is already solved
      }

      if (isBackground) {
        setIsTimerPaused(true);
      } else if (nextAppState === 'active') {
        // Only resume if app is active - tab focus will handle the rest
        setIsTimerPaused(false);
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription?.remove();
    };
  }, [isPuzzleSolved]);

  // Timer effect
  useEffect(() => {
    if (isPuzzleSolved || isTimerPaused) {
      return;
    }
    const interval = setInterval(() => {
      setGameState(prev => ({
        ...prev,
        elapsedTime: prev.elapsedTime + 1
      }));
    }, 1000);

    return () => clearInterval(interval);
  }, [isPuzzleSolved, isTimerPaused]);

  // Focus TextInput when component mounts or when game state changes, but not if puzzle is solved
  useEffect(() => {
    if (gameState.currentWord && !loading && !error && !isPuzzleSolved && shouldRefocus) {
      setTimeout(() => {
        textInputRef.current?.focus();
      }, 100);
    }
  }, [gameState.currentWord, loading, error, isPuzzleSolved, shouldRefocus]);

  // Initialize state management and fetch puzzle data
  useEffect(() => {
    initializeState().then(() => {
      fetchPuzzleData();
    });
  }, []);

  // Check if puzzle date has changed by fetching current puzzle date from API
  const checkForNewPuzzle = async () => {
    try {
      const response = await fetch('/api/puzzles/daily');
      if (response.ok) {
        const data: CrosswordData = await response.json();
        // If dates don't match, fetch new puzzle data
        if (data.date !== puzzleData?.date) {
          fetchPuzzleData();
        }
      }
    } catch (error) {
      // Silently fail - don't disrupt user experience
      console.log('Failed to check for new puzzle:', error);
    }
  };

  // Handle focus/blur to pause/resume timer when switching tabs
  useFocusEffect(
    useCallback(() => {
      // Screen is focused - resume timer if not already solved and app is not in background
      if (!isPuzzleSolved && !isAppInBackground) {
        setIsTimerPaused(false);
      }

      // Check for new puzzle when tab is focused
      checkForNewPuzzle();

      return () => {
        // Screen is losing focus - pause timer if not already solved
        if (!isPuzzleSolved) {
          setIsTimerPaused(true);
        }
      };
    }, [isPuzzleSolved, isAppInBackground])
  );

  const fetchPuzzleData = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/puzzles/daily');
      if (!response.ok) {
        throw new Error('Failed to fetch puzzle');
      }
      const data: CrosswordData = await response.json();
      setPuzzleData(data);
      const baseGrid = convertGridToCells(data);

      // Try to hydrate with saved state for this date
      let hydratedGrid = baseGrid;
      try {
        const saved = await loadPuzzleState(data.date);
        if (saved && Array.isArray(saved.letters)) {
          hydratedGrid = baseGrid.map((row, r) =>
            row.map((cell, c) => {
              const savedLetter = saved.letters?.[r]?.[c];
              return {
                ...cell,
                userLetter: cell.isBlack ? '' : (savedLetter || ''),
              };
            })
          );
        }
      } catch {}

      setGrid(hydratedGrid);

      // Set initial selection to first empty cell (prefer across, then down)
      const firstAcrossEmpty = findFirstEmptySpotInDirection('across', data.clues, hydratedGrid);
      const firstDownEmpty = !firstAcrossEmpty ? findFirstEmptySpotInDirection('down', data.clues, hydratedGrid) : null;
      const start = firstAcrossEmpty || firstDownEmpty || getFirstClueStartInDirection('across', data.clues) || { row: 0, col: 0, direction: 'across' as Direction };
      const initialWord = findWordForPosition(start.row, start.col, start.direction, data.clues, hydratedGrid);

      setGameState(prev => ({
        ...prev,
        selectedRow: start.row,
        selectedCol: start.col,
        direction: start.direction,
        currentWord: initialWord,
        puzzleDate: data.date,
      }));
      
      updateGridHighlighting(hydratedGrid, start.row, start.col, initialWord);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load puzzle');
    } finally {
      setLoading(false);
    }
  };

  const updateGridHighlighting = useCallback((
    currentGrid: CrosswordCell[][], 
    selectedRow: number, 
    selectedCol: number, 
    currentWord: GameState['currentWord']
  ) => {
    const newGrid = currentGrid.map(row => 
      row.map(cell => ({
        ...cell,
        isSelected: false,
        isHighlighted: false,
      }))
    );

    // Highlight current word
    if (currentWord) {
      currentWord.cells.forEach(({ row, col }) => {
        if (newGrid[row] && newGrid[row][col]) {
          newGrid[row][col].isHighlighted = true;
        }
      });
    }

    // Highlight selected cell
    if (newGrid[selectedRow] && newGrid[selectedRow][selectedCol]) {
      newGrid[selectedRow][selectedCol].isSelected = true;
    }

    setGrid(newGrid);
  }, []);

  const handleCellPress = useCallback((row: number, col: number) => {
    if (!puzzleData || grid[row][col].isBlack) return;

    const isSameCell = row === gameState.selectedRow && col === gameState.selectedCol;
    const isInCurrentWord = gameState.currentWord?.cells.some(cell => cell.row === row && cell.col === col);

    let desiredDirection = gameState.direction;

    if (isSameCell) {
      desiredDirection = gameState.direction === 'across' ? 'down' : 'across';
    } else if (!isInCurrentWord) {
      desiredDirection = 'across';
    }

    // Try to find a word in the desired direction first, then fall back to the other direction
    let targetDirection = desiredDirection;
    let targetWord = findWordForPosition(row, col, targetDirection, puzzleData.clues, grid);

    if (!targetWord) {
      const otherDirection = desiredDirection === 'across' ? 'down' : 'across';
      const otherWord = findWordForPosition(row, col, otherDirection, puzzleData.clues, grid);
      if (!otherWord) {
        return; // no word at this cell in either direction
      }
      targetDirection = otherDirection;
      targetWord = otherWord;
    }

    setGameState(prev => ({
      ...prev,
      selectedRow: row,
      selectedCol: col,
      direction: targetDirection,
      currentWord: targetWord,
    }));

    updateGridHighlighting(grid, row, col, targetWord);
    setShouldRefocus(true);
    setTimeout(() => {
      textInputRef.current?.focus();
    }, 0);
  }, [puzzleData, grid, gameState, updateGridHighlighting]);

  const handleBackgroundPress = useCallback(() => {
    setShouldRefocus(false);
    textInputRef.current?.blur();
    Keyboard.dismiss();
  }, []);

  const advanceAfterInput = useCallback((newGrid: CrosswordCell[][], selectedRow: number, selectedCol: number) => {
    if (!gameState.currentWord || !puzzleData) return;

    // Check if puzzle is complete
    const puzzleComplete = isPuzzleComplete(newGrid, puzzleData);
    if (puzzleComplete && !isPuzzleSolved) {
      const finalElapsed = gameState.elapsedTime;
      setGameState(prev => ({
        ...prev,
        elapsedTime: finalElapsed,
      }));
      setIsPuzzleSolved(true);
      setShowCompletionModal(true);
      playBellSound();
      
      // Persist completion time
      if (puzzleData) {
        savePuzzleState(puzzleData.date, { completionSeconds: finalElapsed });
      }
      // Blur the text input to dismiss keyboard
      textInputRef.current?.blur();
      Keyboard.dismiss();
      updateGridHighlighting(newGrid, selectedRow, selectedCol, gameState.currentWord);
      return;
    }

    // Navigation rules (by direction type):
    // 1) Move to the next EMPTY cell in the same word (only after current position)
    const currentIndex = gameState.currentWord.cells.findIndex(c => c.row === selectedRow && c.col === selectedCol);
    let moved = false;
    for (let i = currentIndex + 1; i < gameState.currentWord.cells.length; i++) {
      const cellPos = gameState.currentWord.cells[i];
      if (!newGrid[cellPos.row][cellPos.col].userLetter) {
        setGameState(prev => ({
          ...prev,
          selectedRow: cellPos.row,
          selectedCol: cellPos.col,
        }));
        updateGridHighlighting(newGrid, cellPos.row, cellPos.col, gameState.currentWord);
        moved = true;
        break;
      }
    }

    // If entire board has no empty cells, advance differently:
    // - If there is a next cell in the current word, go there
    // - Otherwise, go to the next word in the same direction
    // - If at the last word in this direction, switch to the first word of the other direction
    if (!moved && !hasAnyEmptyCells(newGrid)) {
      const nextCellInline = getNextCellInWord(selectedRow, selectedCol, gameState.currentWord.cells);
      if (nextCellInline) {
        setGameState(prev => ({
          ...prev,
          selectedRow: nextCellInline.row,
          selectedCol: nextCellInline.col,
        }));
        updateGridHighlighting(newGrid, nextCellInline.row, nextCellInline.col, gameState.currentWord);
        return;
      }

      const currentClue = gameState.currentWord.clue;
      const sameDir: Direction = gameState.direction;
      const nextClueStart = findNextClueStartInDirectionAfter(currentClue, sameDir, puzzleData.clues);
      if (nextClueStart) {
        const newWord = findWordForPosition(nextClueStart.row, nextClueStart.col, sameDir, puzzleData.clues, newGrid);
        if (newWord) {
          setGameState(prev => ({
            ...prev,
            selectedRow: nextClueStart.row,
            selectedCol: nextClueStart.col,
            direction: sameDir,
            currentWord: newWord,
          }));
          updateGridHighlighting(newGrid, nextClueStart.row, nextClueStart.col, newWord);
          return;
        }
      } else {
        const otherDir: Direction = sameDir === 'across' ? 'down' : 'across';
        const firstOtherStart = getFirstClueStartInDirection(otherDir, puzzleData.clues);
        if (firstOtherStart) {
          const newWord = findWordForPosition(firstOtherStart.row, firstOtherStart.col, otherDir, puzzleData.clues, newGrid);
          if (newWord) {
            setGameState(prev => ({
              ...prev,
              selectedRow: firstOtherStart.row,
              selectedCol: firstOtherStart.col,
              direction: otherDir,
              currentWord: newWord,
            }));
            updateGridHighlighting(newGrid, firstOtherStart.row, firstOtherStart.col, newWord);
            return;
          }
        }
      }
    }

    if (!moved) {
      // 2) No empty after within this word: find next empty cell in the SAME direction among subsequent clues
      const currentClue = gameState.currentWord.clue;
      const sameDir: Direction = gameState.direction;

      const nextBlankSameDir = findNextBlankSpotInDirectionAfter(currentClue, sameDir, puzzleData.clues, newGrid);
      if (nextBlankSameDir) {
        const newWord = findWordForPosition(nextBlankSameDir.row, nextBlankSameDir.col, sameDir, puzzleData.clues, newGrid);
        if (newWord) {
          setGameState(prev => ({
            ...prev,
            selectedRow: nextBlankSameDir.row,
            selectedCol: nextBlankSameDir.col,
            direction: sameDir,
            currentWord: newWord,
          }));
          updateGridHighlighting(newGrid, nextBlankSameDir.row, nextBlankSameDir.col, newWord);
          return;
        }
      }

      // 3) Still none: wrap to the first empty cell in the SAME direction
      const firstEmptySameDir = findFirstEmptySpotInDirection(sameDir, puzzleData.clues, newGrid);
      if (firstEmptySameDir) {
        const newWord = findWordForPosition(firstEmptySameDir.row, firstEmptySameDir.col, sameDir, puzzleData.clues, newGrid);
        if (newWord) {
          setGameState(prev => ({
            ...prev,
            selectedRow: firstEmptySameDir.row,
            selectedCol: firstEmptySameDir.col,
            direction: sameDir,
            currentWord: newWord,
          }));
          updateGridHighlighting(newGrid, firstEmptySameDir.row, firstEmptySameDir.col, newWord);
          return;
        }
      }

      // 4) No empty spots in this direction at all: switch to the OTHER direction
      const otherDir: Direction = sameDir === 'across' ? 'down' : 'across';
      const firstEmptyOtherDir = findFirstEmptySpotInDirection(otherDir, puzzleData.clues, newGrid);
      if (firstEmptyOtherDir) {
        const newWord = findWordForPosition(firstEmptyOtherDir.row, firstEmptyOtherDir.col, otherDir, puzzleData.clues, newGrid);
        if (newWord) {
          setGameState(prev => ({
            ...prev,
            selectedRow: firstEmptyOtherDir.row,
            selectedCol: firstEmptyOtherDir.col,
            direction: otherDir,
            currentWord: newWord,
          }));
          updateGridHighlighting(newGrid, firstEmptyOtherDir.row, firstEmptyOtherDir.col, newWord);
          return;
        }
      }

      // Fallback: keep selection
      updateGridHighlighting(newGrid, selectedRow, selectedCol, gameState.currentWord);
    }
  }, [gameState, puzzleData, isPuzzleSolved, updateGridHighlighting, playBellSound]);

  const handleKeyPress = useCallback((key: string) => {
    if (!gameState.currentWord || !puzzleData) return;

    const newGrid = [...grid];
    const { selectedRow, selectedCol } = gameState;
    
    if (newGrid[selectedRow] && newGrid[selectedRow][selectedCol] && !newGrid[selectedRow][selectedCol].isBlack) {
      newGrid[selectedRow][selectedCol] = {
        ...newGrid[selectedRow][selectedCol],
        userLetter: key.toUpperCase(),
      };
      advanceAfterInput(newGrid, selectedRow, selectedCol);
    }
  }, [grid, gameState, puzzleData, updateGridHighlighting, isPuzzleSolved]);

  const handleBackspace = useCallback(() => {
    if (!gameState.currentWord) return;

    const newGrid = [...grid];
    const { selectedRow, selectedCol } = gameState;
    
    if (newGrid[selectedRow] && newGrid[selectedRow][selectedCol] && !newGrid[selectedRow][selectedCol].isBlack) {
      newGrid[selectedRow][selectedCol] = {
        ...newGrid[selectedRow][selectedCol],
        userLetter: '',
      };
      updateGridHighlighting(newGrid, selectedRow, selectedCol, gameState.currentWord);
    }
  }, [grid, gameState, updateGridHighlighting]);

  const handleTextInput = useCallback((text: string) => {
    if (text.length > 0) {
      // Character was added
      const newChar = text[text.length - 1];
      if (/^[A-Za-z]$/.test(newChar)) {
        handleKeyPress(newChar.toUpperCase());
      }
      // Clear the input to allow continuous typing
      setInputValue('');
    } else if (inputValue.length > 0) {
      // Character was deleted (backspace)
      handleBackspace();
      setInputValue('');
    }
  }, [inputValue, handleKeyPress, handleBackspace]);

  const handleRevealSquare = useCallback(() => {
    if (!puzzleData || !gameState.currentWord) return;

    const { selectedRow, selectedCol } = gameState;
    const correctLetter = puzzleData.grid[selectedRow][selectedCol];
    if (!correctLetter) return;

    const newGrid = [...grid];
    if (newGrid[selectedRow] && newGrid[selectedRow][selectedCol] && !newGrid[selectedRow][selectedCol].isBlack) {
      newGrid[selectedRow][selectedCol] = {
        ...newGrid[selectedRow][selectedCol],
        userLetter: String(correctLetter).toUpperCase(),
      };

      advanceAfterInput(newGrid, selectedRow, selectedCol);
    }
  }, [puzzleData, gameState, grid, updateGridHighlighting]);

  // Function to sync completion time with server
  const syncCompletionTime = useCallback(async () => {
    try {
      const token = await getAuthToken();
      if (!token) {
        return; // Can't sync without auth
      }

      const response = await fetch('/api/puzzles/daily/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          completionTime: gameState.elapsedTime,
          date: puzzleData?.date,
        }),
      });

      if (response.status === 409) {
        console.log('Completion already submitted');
      }
    } catch (error) {
      console.log('Failed to sync completion time:', error);
    }
  }, [gameState.elapsedTime, puzzleData?.date]);

  // Sync completion time with server when puzzle becomes solved
  useEffect(() => {
    if (!isPuzzleSolved) {
      return;
    }

    const handleSyncCompletion = async () => {
      if (puzzleData) {
        savePuzzleState(puzzleData.date, { completionSeconds: gameState.elapsedTime });
      }
      
      await syncCompletionTime();
    };

    handleSyncCompletion();
  }, [isPuzzleSolved, syncCompletionTime]);

  // Persist grid letters whenever they change
  useEffect(() => {
    if (!puzzleData || grid.length === 0) return;
    const letters = grid.map(row => row.map(cell => (cell.isBlack ? null : (cell.userLetter || ''))));
    savePuzzleState(puzzleData.date, { letters });
  }, [grid, puzzleData]);

  // Populate completion time and solved state
  useEffect(() => {
    (async () => {
      if (!puzzleData) return;
      const saved = await loadPuzzleState(puzzleData.date);
      if (saved?.completionSeconds && saved.completionSeconds > 0) {
        setIsPuzzleSolved(true);
        // Don't show modal for previously completed puzzles
        const secs = saved.completionSeconds ?? 0;
        setGameState(prev => ({
          ...prev,
          elapsedTime: secs,
        }));
      }
    })();
  }, [puzzleData]);

  const handleDismissModal = useCallback(() => {
    setShowCompletionModal(false);
  }, []);


  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ThemedView style={styles.keyboardContainer}>
          <ThemedText style={styles.loadingText}>Loading puzzle...</ThemedText>
        </ThemedView>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ThemedView style={styles.keyboardContainer}>
          <ThemedText style={styles.errorText}>Error: {error}</ThemedText>
        </ThemedView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView 
        style={styles.keyboardContainer} 
        behavior={'height'}
      >
        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          keyboardDismissMode="none"
        >
          <Pressable onPress={handleBackgroundPress} style={styles.pressableWrapper}>
          <ThemedView style={styles.content}>
            <View onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>
              <CrosswordHeader
              elapsedTime={gameState.elapsedTime}
              currentClue={gameState.currentWord?.clue.clue || ''}
              direction={gameState.direction}
              onRevealSquare={handleRevealSquare}
              />
            </View>
            
            <CrosswordGrid 
              grid={grid} 
              onCellPress={handleCellPress}
              maxSize={computeMaxGridSize({
                windowWidth,
                windowHeight,
                headerHeight,
                safeTop: insets.top,
                safeBottom: insets.bottom,
                reservedKeyboardHeight: stickyKeyboardHeight,
              })}
            />
            
            <TextInput
              ref={textInputRef}
              value={inputValue}
              onChangeText={handleTextInput}
              onKeyPress={({ nativeEvent }) => {
                if (nativeEvent.key === 'Backspace') {
                  handleBackspace();
                }
              }}
              style={styles.hiddenInput}
              autoCapitalize="characters"
              autoCorrect={false}
              keyboardType="default"
              selectTextOnFocus={true}
              autoFocus={true}
              blurOnSubmit={false}
              multiline={false}
              returnKeyType="next"
              caretHidden={true}
              onBlur={() => {
                if (!isPuzzleSolved && shouldRefocus) {
                  setTimeout(() => {
                    textInputRef.current?.focus();
                  }, 0);
                }
              }}
            />
            {isPuzzleSolved && (
              <ThemedView style={styles.completionBanner}>
                <ThemedText style={styles.completionTitle}>Nice work!</ThemedText>
                <ThemedText style={styles.completionSubtitle}>Finished in {formatTime(gameState.elapsedTime)}</ThemedText>
              </ThemedView>
            )}
          </ThemedView>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
      
      {/* Completion Modal */}
      <Modal
        visible={showCompletionModal}
        transparent={true}
        animationType="fade"
        onRequestClose={handleDismissModal}
      >
        <Pressable style={styles.modalOverlay} onPress={handleDismissModal}>
          <BlurView intensity={20} style={styles.blurOverlay}>
            <View style={styles.modalContent}>
              <ThemedText style={styles.modalTitle}>Solved!</ThemedText>
              <ThemedText style={styles.modalTime}>{formatTime(gameState.elapsedTime)}</ThemedText>
            </View>
          </BlurView>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function computeMaxGridSize(params: {
  windowWidth: number;
  windowHeight: number;
  headerHeight: number;
  safeTop: number;
  safeBottom: number;
  reservedKeyboardHeight: number;
}): number {
  const { windowWidth, windowHeight, headerHeight, safeTop, safeBottom, reservedKeyboardHeight } = params;
  const horizontalPadding = SCROLL_CONTENT_HORIZONTAL_PADDING * 2; // scrollContent padding on both sides
  const maxByWidth = windowWidth - horizontalPadding;
  const contentBottomPadding = CONTENT_BOTTOM_PADDING;

  // Available vertical space within the safe area, minus header and reserved keyboard space
  const availableByHeight = windowHeight
    - safeTop
    - headerHeight
    - reservedKeyboardHeight
    - contentBottomPadding;

  const size = Math.min(maxByWidth, availableByHeight, 400);
  return Math.max(0, size);
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  keyboardContainer: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingBottom: CONTENT_BOTTOM_PADDING,
  },
  pressableWrapper: {
    paddingHorizontal: SCROLL_CONTENT_HORIZONTAL_PADDING,
  },
  loadingText: {
    fontSize: 18,
    textAlign: 'center',
    marginTop: 50,
  },
  errorText: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 50,
    color: '#ff6b6b',
  },
  hiddenInput: {
    position: 'absolute',
    left: -1000,
    width: 1,
    height: 1,
    opacity: 0,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: '20%', // Position in top third of screen
  },
  blurOverlay: {
    flex: 1,
    width: '100%',
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: '20%', // Match the overlay positioning
  },
  modalContent: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 50,
    paddingVertical: 40,
    borderRadius: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 10,
    },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
    minWidth: 250, // Ensure adequate width
  },
  modalTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#007AFF',
    marginBottom: 16,
    lineHeight: 40, // Ensure proper line height to prevent cutoff
    textAlign: 'center',
  },
  modalTime: {
    fontSize: 24,
    fontWeight: '600',
    color: '#007AFF',
  },
  completionBanner: {
    marginTop: CONTENT_BOTTOM_PADDING,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#d4e9ff',
    alignItems: 'center',
  },
  completionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#007AFF',
    marginBottom: 4,
  },
  completionSubtitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#007AFF',
  },
});
