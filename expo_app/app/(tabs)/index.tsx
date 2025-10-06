import React, { useState, useEffect, useCallback, useRef } from 'react';
import { StyleSheet, ScrollView, Platform, TextInput, Dimensions, View, Pressable, Keyboard, useWindowDimensions, Modal, AppState, Share } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { Audio, InterruptionModeAndroid } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { loadPuzzleState, savePuzzleState, saveElapsedSeconds } from '@/services/storage';
import { useFriendRequestCount } from '@/services/FriendRequestCountContext';
import { useAuth } from '@/services/AuthContext';
import { withBaseUrl } from '@/constants/Api';
import * as SplashScreen from 'expo-splash-screen';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { CrosswordGrid } from '@/components/CrosswordGrid';
import { CrosswordHeader } from '@/components/CrosswordHeader';
import { SCROLL_CONTENT_HORIZONTAL_PADDING, CONTENT_BOTTOM_PADDING } from '@/constants/Margins';
import { Colors } from '@/constants/Colors';
import { getFriendlyError } from '@/utils/errorUtils';
import { prefetchLeaderboard } from '@/services/leaderboardPrefetch';

import { CrosswordData, CrosswordCell, Direction, GameState } from '@/types/crossword';
import { convertGridToCells, findWordForPosition, isPuzzleComplete, findFirstEmptySpotInDirection, formatTime, hasAnyEmptyCells, getFirstClueStartInDirection, getNextPositionForOverwriteAdvance, getNextPositionForEmptyAdvance, getPrevPositionForBackspace } from '@/utils/crosswordUtils';

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
  const elapsedRef = useRef<number>(0);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [completionSeconds, setCompletionSeconds] = useState<number | null>(null);
  const [shouldRefocus, setShouldRefocus] = useState(true);
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [isTimerPaused, setIsTimerPaused] = useState(false);
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const [stickyKeyboardHeight, setStickyKeyboardHeight] = useState(() => estimateInitialKeyboardReserve());
  const [, setCurrentLoadController] = useState<AbortController | null>(null);
  const [lastLoadedDate, setLastLoadedDate] = useState<string | null>(null);
  const { token, syncAuth } = useAuth();
  const { syncFriendRequestCount } = useFriendRequestCount();
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const [helpMenuAnchor, setHelpMenuAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [isInitialRenderComplete, setIsInitialRenderComplete] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [showReadyModal, setShowReadyModal] = useState(false);
  

  // Function to play bell sound when puzzle is completed
  const playBellSound = useCallback(async () => {
    try {
      const { sound } = await Audio.Sound.createAsync(
        require('../../assets/sounds/bell.mp3')
      );
      
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
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

  const loadPuzzle = useCallback(async (options?: { background?: boolean }) => {
    try { syncAuth().catch(() => {}); } catch {} // ignore failures
    try { syncFriendRequestCount().catch(() => {}); } catch {} // ignore failures
    const background = options?.background === true;
    if (!background) {
      setLoading(true);
      setError(null);
    }

    try {
      // Abort any in-flight request and start a fresh one
      const controller = new AbortController();
      setCurrentLoadController(prev => {
        try { prev?.abort(); } catch {}
        return controller;
      });

      const response = await fetch(withBaseUrl('/api/puzzles/daily'), { signal: controller.signal });
      if (!response.ok) {
        throw new Error('Failed to fetch puzzle');
      }
      const data: CrosswordData = await response.json();

      // If first load or the date changed, hydrate grid and selection
      const isNewOrChanged = lastLoadedDate !== data.date;
      setPuzzleData(data);
      if (isNewOrChanged) {
        // New puzzle date detected: reset completion/modal state and ensure timer can run
        setLoading(true);
        setCompletionSeconds(null);
        setShowCompletionModal(false);
        setIsTimerPaused(false);
        const baseGrid = convertGridToCells(data);

        // Try to hydrate with saved state for this date
        let hydratedGrid = baseGrid;
        let restoredElapsedSeconds = 0;
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
          if (saved?.completionSeconds && saved.completionSeconds > 0) {
            setCompletionSeconds(saved.completionSeconds);
            restoredElapsedSeconds = saved.completionSeconds;
          } else if (saved?.elapsedSeconds && saved.elapsedSeconds > 0) {
            restoredElapsedSeconds = saved.elapsedSeconds;
          }
          
          if (saved?.hasStarted) {
            setHasStarted(true);
          }
        } catch {}

        // Keep the ticking ref in sync with restored elapsed seconds
        elapsedRef.current = restoredElapsedSeconds;

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
          elapsedTime: restoredElapsedSeconds,
        }));

        updateGridHighlighting(hydratedGrid, start.row, start.col, initialWord);
      } else {
        // Same day: ensure completion time stays synced if previously solved
        if (completionSeconds) {
          persistProgress(grid, { completionSeconds: completionSeconds });
        }
      }

      // Track latest date
      setLastLoadedDate(data.date);
    } catch (err) {
      // Ignore abort errors from canceled requests
      if ((err as any)?.name === 'AbortError') {
        return;
      }
      // If network fails and we already have a puzzle loaded, suppress error
      if (puzzleData) {
        return;
      }
      // Try to use any locally saved letters/timer for current date if known
      // If we don't know the date yet and no puzzle is loaded, we have nothing to show
      setError(getFriendlyError(err, 'Failed to load puzzle').message);
    } finally {
      setLoading(false);
    }
  }, [updateGridHighlighting, syncAuth, syncFriendRequestCount, lastLoadedDate]);

  const handleCellPress = useCallback((row: number, col: number) => {
    if (!puzzleData || grid[row][col].isBlack) return;

    const isSameCell = row === gameState.selectedRow && col === gameState.selectedCol;

    let desiredDirection = gameState.direction;

    if (isSameCell) {
      desiredDirection = gameState.direction === 'across' ? 'down' : 'across';
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
    textInputRef.current?.focus();
  }, [puzzleData, grid, gameState, updateGridHighlighting]);

  const handleBackgroundPress = useCallback(() => {
    setShouldRefocus(false);
    textInputRef.current?.blur();
    Keyboard.dismiss();
  }, []);

  // Persist progress (letters) and, if complete, persist and sync completion time
  const persistProgress = useCallback(async (gridToPersist: CrosswordCell[][], options: { completionSeconds: number }) => {
    if (!puzzleData || gridToPersist.length === 0) return;
    const letters = gridToPersist.map(row => row.map(cell => (cell.isBlack ? null : (cell.userLetter || ''))));
    savePuzzleState(puzzleData.date, { letters });
    // Always persist hasStarted flag
    if (hasStarted) {
      savePuzzleState(puzzleData.date, { hasStarted: true });
    }
    // Always persist in-progress elapsed time
    if (options?.completionSeconds >= 0) {
      savePuzzleState(puzzleData.date, { elapsedSeconds: options.completionSeconds });
    }

    // If complete, persist completion time locally and sync to server
    if (isPuzzleComplete(gridToPersist, puzzleData)) {
      const completionSeconds = options.completionSeconds;
      if (completionSeconds > 0) {
        savePuzzleState(puzzleData.date, { completionSeconds });
      }
      try {
        const t = token;
        if (!t) {
          return; // Can't sync without auth
        }
        await fetch(withBaseUrl('/api/puzzles/daily/complete'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${t}`,
          },
          body: JSON.stringify({
            timeMs: completionSeconds * 1000,
          }),
        });
        // Prefetch leaderboard in the background so it is ready when user navigates
        try { prefetchLeaderboard(t).catch(() => {}); } catch {}
      } catch (error) {
        console.log('Failed to sync completion time:', error);
      }
    }
  }, [puzzleData, token, hasStarted]);

  const advanceAfterInput = useCallback((newGrid: CrosswordCell[][], selectedRow: number, selectedCol: number, insertedIntoEmpty: boolean) => {
    if (!gameState.currentWord || !puzzleData) return;

    // Check if puzzle is complete
    const puzzleComplete = isPuzzleComplete(newGrid, puzzleData);
    if (puzzleComplete && !completionSeconds) {
      const finalElapsed = gameState.elapsedTime;
      setGameState(prev => ({
        ...prev,
        elapsedTime: finalElapsed,
      }));
      setCompletionSeconds(finalElapsed);
      setShowCompletionModal(true);
      playBellSound();
      
      // Persist and sync completion time via unified progress persister
      persistProgress(newGrid, { completionSeconds: finalElapsed });
      // Blur the text input to dismiss keyboard
      textInputRef.current?.blur();
      Keyboard.dismiss();
      updateGridHighlighting(newGrid, selectedRow, selectedCol, gameState.currentWord);
      return;
    }

    // Overwrite behavior: user typed over a filled cell -> advance by one inline regardless of emptiness
    if (!insertedIntoEmpty) {
      const next = getNextPositionForOverwriteAdvance(
        selectedRow,
        selectedCol,
        gameState.direction,
        gameState.currentWord,
        puzzleData.clues,
      );
      if (next) {
        const newWord = findWordForPosition(next.row, next.col, next.direction, puzzleData.clues, newGrid);
        if (newWord) {
          setGameState(prev => ({
            ...prev,
            selectedRow: next.row,
            selectedCol: next.col,
            direction: next.direction,
            currentWord: newWord,
          }));
          updateGridHighlighting(newGrid, next.row, next.col, newWord);
          return;
        }
      }
      // Fallback: keep selection
      updateGridHighlighting(newGrid, selectedRow, selectedCol, gameState.currentWord);
      return;
    }

    // Empty-cell behavior: use helper to compute destination
    const next = getNextPositionForEmptyAdvance(
      selectedRow,
      selectedCol,
      gameState.direction,
      gameState.currentWord,
      puzzleData.clues,
      newGrid,
    );
    if (next) {
      const newWord = findWordForPosition(next.row, next.col, next.direction, puzzleData.clues, newGrid);
      if (newWord) {
        setGameState(prev => ({
          ...prev,
          selectedRow: next.row,
          selectedCol: next.col,
          direction: next.direction,
          currentWord: newWord,
        }));
        updateGridHighlighting(newGrid, next.row, next.col, newWord);
        return;
      }
    }
    // Fallback: keep selection
    updateGridHighlighting(newGrid, selectedRow, selectedCol, gameState.currentWord);
  }, [gameState, puzzleData, completionSeconds, updateGridHighlighting, playBellSound, persistProgress]);

  const handleKeyPress = useCallback((key: string) => {
    if (!gameState.currentWord || !puzzleData) return;

    const newGrid = [...grid];
    const { selectedRow, selectedCol } = gameState;
    
    if (newGrid[selectedRow] && newGrid[selectedRow][selectedCol] && !newGrid[selectedRow][selectedCol].isBlack) {
      const wasEmpty = !newGrid[selectedRow][selectedCol].userLetter;
      newGrid[selectedRow][selectedCol] = {
        ...newGrid[selectedRow][selectedCol],
        userLetter: key.toUpperCase(),
      };
      persistProgress(newGrid, { completionSeconds: gameState.elapsedTime });
      advanceAfterInput(newGrid, selectedRow, selectedCol, wasEmpty);
    }
  }, [grid, gameState, puzzleData, updateGridHighlighting, completionSeconds, persistProgress]);

  const handleBackspace = useCallback(() => {
    if (!gameState.currentWord) return;

    const { selectedRow, selectedCol } = gameState;
    const newGrid = [...grid];

    if (newGrid[selectedRow] && newGrid[selectedRow][selectedCol] && !newGrid[selectedRow][selectedCol].isBlack) {
      // Clear current cell
      newGrid[selectedRow][selectedCol] = {
        ...newGrid[selectedRow][selectedCol],
        userLetter: '',
      };

      // Compute previous position following backspace rules
      const prev = getPrevPositionForBackspace(
        selectedRow,
        selectedCol,
        gameState.direction,
        gameState.currentWord,
        puzzleData?.clues || [],
      );

      if (prev) {
        const newWord = puzzleData ? findWordForPosition(prev.row, prev.col, prev.direction, puzzleData.clues, newGrid) : null;
        if (newWord) {
          setGameState(prevState => ({
            ...prevState,
            selectedRow: prev.row,
            selectedCol: prev.col,
            direction: prev.direction,
            currentWord: newWord,
          }));
          persistProgress(newGrid, { completionSeconds: gameState.elapsedTime });
          updateGridHighlighting(newGrid, prev.row, prev.col, newWord);
          return;
        }
      }

      // Fallback: keep selection if no previous position found
      persistProgress(newGrid, { completionSeconds: gameState.elapsedTime });
      updateGridHighlighting(newGrid, selectedRow, selectedCol, gameState.currentWord);
    }
  }, [grid, gameState, puzzleData, updateGridHighlighting, persistProgress]);

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

  const handleNext = useCallback(() => {
    if (!puzzleData || !gameState.currentWord) return;

    const next = getNextPositionForEmptyAdvance(
      gameState.selectedRow,
      gameState.selectedCol,
      gameState.direction,
      gameState.currentWord,
      puzzleData.clues,
      grid,
      true, // nextButton = true to skip backward-looking in same word
    );

    if (next) {
      const newWord = findWordForPosition(next.row, next.col, next.direction, puzzleData.clues, grid);
      if (newWord) {
        setGameState(prev => ({
          ...prev,
          selectedRow: next.row,
          selectedCol: next.col,
          direction: next.direction,
          currentWord: newWord,
        }));
        updateGridHighlighting(grid, next.row, next.col, newWord);
      }
    }
  }, [puzzleData, gameState, grid, updateGridHighlighting]);

  const handleRevealSquare = useCallback(() => {
    if (!puzzleData || !gameState.currentWord) return;

    const { selectedRow, selectedCol } = gameState;
    const correctLetter = puzzleData.grid[selectedRow][selectedCol];
    if (!correctLetter) return;

    const newGrid = [...grid];
    if (newGrid[selectedRow] && newGrid[selectedRow][selectedCol] && !newGrid[selectedRow][selectedCol].isBlack) {
      const wasEmpty = !newGrid[selectedRow][selectedCol].userLetter;
      newGrid[selectedRow][selectedCol] = {
        ...newGrid[selectedRow][selectedCol],
        userLetter: String(correctLetter).toUpperCase(),
      };

      persistProgress(newGrid, { completionSeconds: gameState.elapsedTime });
      advanceAfterInput(newGrid, selectedRow, selectedCol, wasEmpty);
    }
  }, [puzzleData, gameState, grid, updateGridHighlighting, persistProgress]);

  

  const handleRevealPuzzle = useCallback(() => {
    if (!puzzleData) return;

    // Fill the entire grid with correct answers
    const newGrid: CrosswordCell[][] = grid.map((row, r) =>
      row.map((cell, c) => {
        if (cell.isBlack) return cell;
        const correctLetter = puzzleData.grid[r][c];
        return {
          ...cell,
          userLetter: String(correctLetter || '').toUpperCase(),
        };
      })
    );

    // Mark as completed and show modal
    const finalElapsed = gameState.elapsedTime;
    setGrid(newGrid);
    setCompletionSeconds(finalElapsed);
    setShowCompletionModal(true);
    playBellSound();
    persistProgress(newGrid, { completionSeconds: finalElapsed });
    // Dismiss keyboard so the button becomes visible space-wise
    textInputRef.current?.blur();
    Keyboard.dismiss();
    if (gameState.currentWord) {
      updateGridHighlighting(newGrid, gameState.selectedRow, gameState.selectedCol, gameState.currentWord);
    }
  }, [grid, puzzleData, gameState, playBellSound, persistProgress, updateGridHighlighting]);

  const handleDismissModal = useCallback(() => {
    setShowCompletionModal(false);
  }, []);

  const handleStartPuzzle = useCallback(() => {
    setHasStarted(true);
    setShowReadyModal(false);
    if (puzzleData) {
      savePuzzleState(puzzleData.date, { hasStarted: true });
    }
    // Focus the input after starting
    setShouldRefocus(true);
    textInputRef.current?.focus();
  }, [puzzleData]);

  const handleShareScore = useCallback(async () => {
    if (!completionSeconds || !puzzleData) return;

    const formattedTime = formatTime(completionSeconds);
    
    // Universal link that works for both iOS and Android
    // If user has the app, it will open automatically
    // If not, they'll be redirected to the appropriate store
    const shareUrl = 'https://conradscrossword.com/share';
    
    const message = `I completed Conrad's Crossword in ${formattedTime}!\n\n${shareUrl}`;

    try {
      await Share.share({
        message,
      });
    } catch (error) {
      console.log('Error sharing score:', error);
    }
  }, [completionSeconds, puzzleData]);

  // Track the largest keyboard height seen this session and keep reserving it
  useEffect(() => {
    const handleKeyboardEvent = (e: any) => {
      const nextHeight = e?.endCoordinates?.height ?? 0;
      if (nextHeight > 0) {
        setStickyKeyboardHeight(prev => Math.max(prev, nextHeight));
      }
    };

    const primaryEvent = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const subPrimary = Keyboard.addListener(primaryEvent as any, handleKeyboardEvent);
    // On iOS, also listen to didShow as a fallback to catch cases where frame change may not fire
    const subSecondary = Platform.OS === 'ios'
      ? Keyboard.addListener('keyboardDidShow', handleKeyboardEvent)
      : null;

    return () => {
      subPrimary.remove();
      subSecondary?.remove();
    };
  }, []);

  // Timer tick + persist effect
  useEffect(() => {
    if (completionSeconds || isTimerPaused || !puzzleData || !hasStarted) {
      return;
    }
    const interval = setInterval(() => {
      setGameState(prev => {
        const nextElapsed = prev.elapsedTime + 1;
        elapsedRef.current = nextElapsed;
        return {
          ...prev,
          elapsedTime: nextElapsed,
        };
      });
      try {
        const seconds = Math.max(0, Math.floor(elapsedRef.current || 0));
        if (puzzleData?.date) {
          saveElapsedSeconds(puzzleData.date, seconds);
        }
      } catch {}
    }, 1000);

    return () => clearInterval(interval);
  }, [completionSeconds, isTimerPaused, puzzleData, hasStarted]);

  // Hide splash screen and pull up the keyboard after initial render is complete
  useEffect(() => {
    if (!loading && (puzzleData || error) && !isInitialRenderComplete) {
      setIsInitialRenderComplete(true);
      // Use requestAnimationFrame to ensure the render is complete
      requestAnimationFrame(async () => {
        try {
          await SplashScreen.hideAsync();
          // Show ready modal if user hasn't started yet
          setShowReadyModal(!hasStarted);
        } catch (e) {
          console.log('Error hiding splash screen:', e);
        }
      });
    }
  }, [loading, puzzleData, isInitialRenderComplete, error]);

  // Trigger a puzzle load when re-opening the app
  useEffect(() => {
    const handleAppStateChange = (nextAppState: string) => {
      if (nextAppState === 'active') {
        loadPuzzle({ background: true });
      }
    };
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, [loadPuzzle]);

    // Handle focus: manage timer + load/refresh puzzle; also track AppState while focused
  useFocusEffect(
    useCallback(() => {
      // On focus, set timer paused based on current app state
      if (!completionSeconds) {
        const currentState = AppState.currentState as unknown as string | null;
        const isBackground = currentState === 'background' || currentState === 'inactive';
        setIsTimerPaused(!!isBackground);
      }

      // On first focus, do a foreground load to clear loading; afterwards, background refreshes
      const isFirstLoad = !lastLoadedDate;
      if (isFirstLoad) {
        loadPuzzle({ background: false });
      } else {
        loadPuzzle({ background: true });
      }

      // While this screen is focused, respond to app state changes
      const handleAppStateChange = (nextAppState: string) => {
        if (completionSeconds) return;
        const isBackground = nextAppState === 'background' || nextAppState === 'inactive';
        setIsTimerPaused(isBackground);
      };
      const subscription = AppState.addEventListener('change', handleAppStateChange);

      return () => {
        subscription?.remove();
        if (!completionSeconds) {
          setIsTimerPaused(true);
        }
      };
    }, [loadPuzzle, completionSeconds, lastLoadedDate])
  );

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
          <ThemedText style={styles.errorText}>{error}</ThemedText>
        </ThemedView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View 
        style={styles.keyboardContainer}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollViewContent}
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
              onRevealPuzzle={handleRevealPuzzle}
              isCompleted={!!completionSeconds}
              isHelpMenuOpen={helpMenuOpen}
              onOpenHelpMenu={(anchor) => {
                setHelpMenuAnchor(anchor);
                setHelpMenuOpen(true);
              }}
              />
            </View>
            
            <View style={styles.gridBackground}> 
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
                  contentBottomPadding: stickyKeyboardHeight > 0 ? 0 : CONTENT_BOTTOM_PADDING,
                })}
              />
            </View>
            
            
            <TextInput
              ref={textInputRef}
              value={inputValue}
              onChangeText={handleTextInput}
              onKeyPress={({ nativeEvent }) => {
                if (nativeEvent.key === 'Backspace') {
                  handleBackspace();
                }
              }}
              onSubmitEditing={handleNext}
              style={styles.hiddenInput}
              autoCapitalize="characters"
              autoCorrect={false}
              keyboardType="default"
              selectTextOnFocus={true}
              autoFocus={false}
              blurOnSubmit={false}
              multiline={false}
              returnKeyType="next"
              caretHidden={true}
              allowFontScaling={false}
              maxFontSizeMultiplier={1}
            />
            {completionSeconds && (
              <ThemedView style={styles.completionBanner}>
                <View style={styles.completionContent}>
                  <View style={styles.completionTextContainer}>
                    <ThemedText style={styles.completionTitle}>Nice work!</ThemedText>
                    <ThemedText style={styles.completionSubtitle}>New puzzle at midnight! (PT)</ThemedText>
                  </View>
                  <Pressable 
                    style={styles.shareButton}
                    onPress={handleShareScore}
                  >
                    <Ionicons name="paper-plane" size={24} color="#007AFF" />
                  </Pressable>
                </View>
              </ThemedView>
            )}
          </ThemedView>
          </Pressable>
        </ScrollView>
        {helpMenuOpen && (
          <View style={styles.menuRoot} pointerEvents="box-none">
            <Pressable
              style={styles.menuBackdrop}
              onPress={() => {
                setHelpMenuOpen(false);
              }}
            />
            <View
              style={[
                styles.menuContainer,
                helpMenuAnchor ? {
                  top: helpMenuAnchor.y - insets.top + helpMenuAnchor.height + 4,
                  right: Math.max(12, Dimensions.get('window').width - (helpMenuAnchor.x + helpMenuAnchor.width)),
                } : { top: 44, right: 12 },
              ]}
            >
              <Pressable
                style={styles.menuItem}
                onPress={() => {
                  setHelpMenuOpen(false);
                  handleRevealSquare();
                }}
              >
                <ThemedText style={styles.menuItemText}>Reveal square</ThemedText>
              </Pressable>
              {!completionSeconds && (
                <>
                  <View style={styles.menuDivider} />
                  <Pressable
                    style={styles.menuItem}
                    onPress={() => {
                      setHelpMenuOpen(false);
                      handleRevealPuzzle();
                    }}
                  >
                    <ThemedText style={styles.menuItemText}>Reveal puzzle</ThemedText>
                  </Pressable>
                </>
              )}
            </View>
          </View>
        )}
      </View>
      
      {/* Ready Modal */}
      <Modal
        visible={showReadyModal}
        transparent={true}
        animationType="fade"
        statusBarTranslucent={true}
        onRequestClose={handleStartPuzzle}
      >
        <View style={styles.modalOverlay}>
          {Platform.OS === 'ios' ? (
            <BlurView intensity={20} style={styles.blurOverlay}>
              <View style={styles.modalContentWrapper}>
                <View style={styles.modalContent}>
                  <ThemedText style={styles.modalTitle}>Ready?</ThemedText>
                  <Pressable style={styles.startButton} onPress={handleStartPuzzle}>
                    <ThemedText style={styles.startButtonText}>Go</ThemedText>
                  </Pressable>
                </View>
              </View>
            </BlurView>
          ) : (
            <View style={styles.androidOverlay}>
              <View style={styles.modalContentWrapper}>
                <View style={styles.modalContent}>
                  <ThemedText style={styles.modalTitle}>Ready?</ThemedText>
                  <Pressable style={styles.startButton} onPress={handleStartPuzzle}>
                    <ThemedText style={styles.startButtonText}>Go</ThemedText>
                  </Pressable>
                </View>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* Completion Modal */}
      <Modal
        visible={showCompletionModal}
        transparent={true}
        animationType="fade"
        statusBarTranslucent={true}
        onRequestClose={handleDismissModal}
      >
        <Pressable style={styles.modalOverlay} onPress={handleDismissModal}>
          {Platform.OS === 'ios' ? (
            <BlurView intensity={20} style={styles.blurOverlay}>
              <View style={styles.modalContentWrapper}>
                <View style={styles.modalContent}>
                  <ThemedText style={styles.modalTitle}>Solved!</ThemedText>
                  <ThemedText style={styles.modalTime}>{formatTime(gameState.elapsedTime)}</ThemedText>
                </View>
              </View>
            </BlurView>
          ) : (
            <View style={styles.androidOverlay}>
              <View style={styles.modalContentWrapper}>
                <View style={styles.modalContent}>
                  <ThemedText style={styles.modalTitle}>Solved!</ThemedText>
                  <ThemedText style={styles.modalTime}>{formatTime(gameState.elapsedTime)}</ThemedText>
                </View>
              </View>
            </View>
          )}
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
  contentBottomPadding: number;
}): number {
  const { windowWidth, windowHeight, headerHeight, safeTop, safeBottom, reservedKeyboardHeight, contentBottomPadding } = params;
  // No horizontal padding: allow grid to use full width
  const maxByWidth = windowWidth;
  const maxKeyboardReserve = Math.min(400, windowHeight * 0.5);
  const clampedKeyboardReserve = Math.max(0, Math.min(reservedKeyboardHeight, maxKeyboardReserve));

  // Available vertical space within the safe area, minus header and reserved keyboard space
  const availableByHeight = windowHeight
    - safeTop
    - headerHeight
    - clampedKeyboardReserve
    - contentBottomPadding;

  const size = Math.min(maxByWidth, availableByHeight);
  return Math.max(0, size);
}

// Seed an initial keyboard reserve so the grid doesn't jump from 0 → real height
function estimateInitialKeyboardReserve(): number {
  if (Platform.OS === 'ios') {
    return 260;
  }
  // Android keyboards tend to be a bit taller on average
  return 320;
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
  scrollViewContent: {
    flexGrow: 1,
  },
  content: {
    paddingBottom: 0,
  },
  gridBackground: {
    backgroundColor: Colors.light.surfaceHeader,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  pressableWrapper: {
    paddingHorizontal: 0,
    flex: 1,
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
    paddingHorizontal: SCROLL_CONTENT_HORIZONTAL_PADDING,
    color: '#000',
  },
  hiddenInput: {
    position: 'absolute',
    left: -1000,
    width: 1,
    height: 1,
    opacity: 0,
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  blurOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  androidOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  modalContentWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
    paddingVertical: 12,
    paddingHorizontal: 8,
    backgroundColor: '#d4e9ff',
  },
  completionContent: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  completionTextContainer: {
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
  shareButton: {
    position: 'absolute',
    right: 0,
    padding: 8,
  },
  menuRoot: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  menuBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'transparent',
  },
  menuContainer: {
    position: 'absolute',
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
  startButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 16,
  },
  startButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
});
