import { CrosswordData, CrosswordCell, CrosswordClue, Direction } from '@/types/crossword';

export function convertGridToCells(data: CrosswordData): CrosswordCell[][] {
  const grid = data.grid;
  const cells: CrosswordCell[][] = [];
  
  // Initialize grid
  for (let i = 0; i < grid.length; i++) {
    cells[i] = [];
    for (let j = 0; j < grid[i].length; j++) {
      const letter = grid[i][j];
      cells[i][j] = {
        letter: letter || '',
        isBlack: letter === null,
        userLetter: '',
      };
    }
  }
  
  return cells;
}

export function findWordForPosition(
  row: number, 
  col: number, 
  direction: Direction, 
  clues: CrosswordClue[],
  grid: CrosswordCell[][]
): { clue: CrosswordClue; cells: { row: number; col: number }[] } | null {
  const relevantClues = clues.filter(clue => {
    if (clue.direction !== direction) return false;
    
    if (direction === 'across') {
      return row === clue.row && col >= clue.col && col < clue.col + clue.length;
    } else {
      return col === clue.col && row >= clue.row && row < clue.row + clue.length;
    }
  });
  
  if (relevantClues.length === 0) return null;
  
  const clue = relevantClues[0];
  const cells: { row: number; col: number }[] = [];
  
  for (let i = 0; i < clue.length; i++) {
    if (direction === 'across') {
      const cellCol = clue.col + i;
      if (grid[clue.row] && grid[clue.row][cellCol] && !grid[clue.row][cellCol].isBlack) {
        cells.push({ row: clue.row, col: cellCol });
      }
    } else {
      const cellRow = clue.row + i;
      if (grid[cellRow] && grid[cellRow][clue.col] && !grid[cellRow][clue.col].isBlack) {
        cells.push({ row: cellRow, col: clue.col });
      }
    }
  }
  
  return { clue, cells };
}

// Returns the next cell within the same word, or null if at end
export function getNextCellInWord(
  currentRow: number,
  currentCol: number,
  wordCells: { row: number; col: number }[],
): { row: number; col: number } | null {
  const currentIndex = wordCells.findIndex(cell => cell.row === currentRow && cell.col === currentCol);
  if (currentIndex >= 0 && currentIndex < wordCells.length - 1) {
    return wordCells[currentIndex + 1];
  }
  return null;
}

// Returns the previous cell within the same word, or null if at start
export function getPrevCellInWord(
  currentRow: number,
  currentCol: number,
  wordCells: { row: number; col: number }[],
): { row: number; col: number } | null {
  const currentIndex = wordCells.findIndex(cell => cell.row === currentRow && cell.col === currentCol);
  if (currentIndex > 0) {
    return wordCells[currentIndex - 1];
  }
  return null;
}

function getOrderedCluesByDirection(clues: CrosswordClue[], direction: Direction): CrosswordClue[] {
  const filtered = clues.filter(c => c.direction === direction);
  if (direction === 'across') {
    return filtered.sort((a, b) => (a.row - b.row) || (a.col - b.col));
  }
  return filtered.sort((a, b) => (a.col - b.col) || (a.row - b.row));
}

function areCluesSame(a: CrosswordClue, b: CrosswordClue): boolean {
  return a.direction === b.direction && a.row === b.row && a.col === b.col && a.length === b.length && a.clue === b.clue;
}

function findFirstEmptyCellInClue(
  clue: CrosswordClue,
  grid: CrosswordCell[][]
): { row: number; col: number } | null {
  for (let i = 0; i < clue.length; i++) {
    const row = clue.direction === 'across' ? clue.row : clue.row + i;
    const col = clue.direction === 'across' ? clue.col + i : clue.col;
    if (grid[row] && grid[row][col] && !grid[row][col].isBlack && !grid[row][col].userLetter) {
      return { row, col };
    }
  }
  return null;
}

export function findNextBlankSpotInDirectionAfter(
  currentClue: CrosswordClue,
  direction: Direction,
  clues: CrosswordClue[],
  grid: CrosswordCell[][]
): { row: number; col: number; direction: Direction } | null {
  const ordered = getOrderedCluesByDirection(clues, direction);
  const index = ordered.findIndex(c => areCluesSame(c, currentClue));
  for (let i = index + 1; i < ordered.length; i++) {
    const emptyCell = findFirstEmptyCellInClue(ordered[i], grid);
    if (emptyCell) {
      return { row: emptyCell.row, col: emptyCell.col, direction };
    }
  }
  return null;
}

export function findNextClueStartInDirectionAfter(
  currentClue: CrosswordClue,
  direction: Direction,
  clues: CrosswordClue[]
): { row: number; col: number; direction: Direction } | null {
  const ordered = getOrderedCluesByDirection(clues, direction);
  const index = ordered.findIndex(c => areCluesSame(c, currentClue));
  if (index >= 0 && index + 1 < ordered.length) {
    const next = ordered[index + 1];
    return { row: next.row, col: next.col, direction };
  }
  return null;
}

export function findFirstEmptySpotInDirection(
  direction: Direction,
  clues: CrosswordClue[],
  grid: CrosswordCell[][]
): { row: number; col: number; direction: Direction } | null {
  const ordered = getOrderedCluesByDirection(clues, direction);
  for (const clue of ordered) {
    const emptyCell = findFirstEmptyCellInClue(clue, grid);
    if (emptyCell) {
      return { row: emptyCell.row, col: emptyCell.col, direction };
    }
  }
  return null;
}

// When overwriting a filled cell, advance to the next cell in the current word;
// if none, go to the next clue in the same direction; otherwise wrap to the
// first clue of the other direction. Returns null if no move is possible.
export function getNextPositionForOverwriteAdvance(
  currentRow: number,
  currentCol: number,
  direction: Direction,
  currentWord: { clue: CrosswordClue; cells: { row: number; col: number }[] },
  clues: CrosswordClue[],
): { row: number; col: number; direction: Direction } | null {
  const nextCellInline = getNextCellInWord(currentRow, currentCol, currentWord.cells);
  if (nextCellInline) {
    return { row: nextCellInline.row, col: nextCellInline.col, direction };
  }

  const nextClueStart = findNextClueStartInDirectionAfter(currentWord.clue, direction, clues);
  if (nextClueStart) {
    return { row: nextClueStart.row, col: nextClueStart.col, direction };
  }

  const otherDir: Direction = direction === 'across' ? 'down' : 'across';
  const firstOtherStart = getFirstClueStartInDirection(otherDir, clues);
  if (firstOtherStart) {
    return { row: firstOtherStart.row, col: firstOtherStart.col, direction: otherDir };
  }

  return null;
}

// When typing into an empty cell, advance to the next empty cell: prefer next empty in current word; if none after
// current position, check for empties at the start of the same word; if the board
// has no empties, advance inline/next word; otherwise search next empty in
// same direction, then wrap, then other direction.
export function getNextPositionForEmptyAdvance(
  currentRow: number,
  currentCol: number,
  direction: Direction,
  currentWord: { clue: CrosswordClue; cells: { row: number; col: number }[] },
  clues: CrosswordClue[],
  grid: CrosswordCell[][],
  nextButton: boolean = false,
): { row: number; col: number; direction: Direction } | null {
  // 1) Next empty in current word, after current position
  const currentIndex = currentWord.cells.findIndex(c => c.row === currentRow && c.col === currentCol);
  for (let i = currentIndex + 1; i < currentWord.cells.length; i++) {
    const cellPos = currentWord.cells[i];
    if (!grid[cellPos.row][cellPos.col].userLetter) {
      return { row: cellPos.row, col: cellPos.col, direction };
    }
  }

  // 2) If no empty after current position, check for empty slots before current position in same word
  // Skip this step if nextButton is true (user pressed next button, not typing)
  if (!nextButton) {
    for (let i = 0; i < currentIndex; i++) {
      const cellPos = currentWord.cells[i];
      if (!grid[cellPos.row][cellPos.col].userLetter) {
        return { row: cellPos.row, col: cellPos.col, direction };
      }
    }
  }

  // If entire board has no empty cells, follow inline/next-word flow
  if (!hasAnyEmptyCells(grid)) {
    const nextCellInline = getNextCellInWord(currentRow, currentCol, currentWord.cells);
    if (nextCellInline) {
      return { row: nextCellInline.row, col: nextCellInline.col, direction };
    }

    const nextClueStart = findNextClueStartInDirectionAfter(currentWord.clue, direction, clues);
    if (nextClueStart) {
      return { row: nextClueStart.row, col: nextClueStart.col, direction };
    }

    const otherDir: Direction = direction === 'across' ? 'down' : 'across';
    const firstOtherStart = getFirstClueStartInDirection(otherDir, clues);
    if (firstOtherStart) {
      return { row: firstOtherStart.row, col: firstOtherStart.col, direction: otherDir };
    }
    return null;
  }

  // 3) Next empty among subsequent clues in same direction
  const nextBlankSameDir = findNextBlankSpotInDirectionAfter(currentWord.clue, direction, clues, grid);
  if (nextBlankSameDir) {
    return { row: nextBlankSameDir.row, col: nextBlankSameDir.col, direction };
  }

  // 4) Wrap to first empty in same direction
  const firstEmptySameDir = findFirstEmptySpotInDirection(direction, clues, grid);
  if (firstEmptySameDir) {
    return { row: firstEmptySameDir.row, col: firstEmptySameDir.col, direction };
  }

  // 5) Switch to other direction, first empty there
  const otherDir: Direction = direction === 'across' ? 'down' : 'across';
  const firstEmptyOtherDir = findFirstEmptySpotInDirection(otherDir, clues, grid);
  if (firstEmptyOtherDir) {
    return { row: firstEmptyOtherDir.row, col: firstEmptyOtherDir.col, direction: otherDir };
  }

  return null;
}

export function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// Compute the previous position to move to when handling backspace.
// The behavior mirrors a simple "step back":
// 1) Previous cell within current word; else
// 2) Last cell of previous clue in same direction; else
// 3) Wrap to last cell of last clue in same direction; else
// 4) Wrap to last cell of last clue in the other direction.
export function getPrevPositionForBackspace(
  currentRow: number,
  currentCol: number,
  direction: Direction,
  currentWord: { clue: CrosswordClue; cells: { row: number; col: number }[] },
  clues: CrosswordClue[],
): { row: number; col: number; direction: Direction } | null {
  // Previous within the same word
  const prevCell = getPrevCellInWord(currentRow, currentCol, currentWord.cells);
  if (prevCell) {
    return { row: prevCell.row, col: prevCell.col, direction };
  }

  // Previous clue in same direction
  const ordered = getOrderedCluesByDirection(clues, direction);
  const index = ordered.findIndex(c => areCluesSame(c, currentWord.clue));
  if (index > 0) {
    const prevClue = ordered[index - 1];
    const row = direction === 'across' ? prevClue.row : prevClue.row + prevClue.length - 1;
    const col = direction === 'across' ? prevClue.col + prevClue.length - 1 : prevClue.col;
    return { row, col, direction };
  }

  // Wrap to last clue in same direction
  if (ordered.length > 0) {
    const last = ordered[ordered.length - 1];
    const row = direction === 'across' ? last.row : last.row + last.length - 1;
    const col = direction === 'across' ? last.col + last.length - 1 : last.col;
    return { row, col, direction };
  }

  // Fallback: last clue in the other direction
  const otherDir: Direction = direction === 'across' ? 'down' : 'across';
  const orderedOther = getOrderedCluesByDirection(clues, otherDir);
  if (orderedOther.length > 0) {
    const last = orderedOther[orderedOther.length - 1];
    const row = otherDir === 'across' ? last.row : last.row + last.length - 1;
    const col = otherDir === 'across' ? last.col + last.length - 1 : last.col;
    return { row, col, direction: otherDir };
  }

  return null;
}

export function isPuzzleComplete(grid: CrosswordCell[][], puzzleData: CrosswordData): boolean {
  // Check if all non-black cells have the correct letters
  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row].length; col++) {
      const cell = grid[row][col];
      if (!cell.isBlack) {
        const correctLetter = puzzleData.grid[row][col];
        if (!cell.userLetter || cell.userLetter.toLowerCase() !== correctLetter?.toLowerCase()) {
          return false;
        }
      }
    }
  }
  return true;
}

export function hasAnyEmptyCells(currentGrid: CrosswordCell[][]): boolean {
  for (let r = 0; r < currentGrid.length; r++) {
    for (let c = 0; c < currentGrid[r].length; c++) {
      const cell = currentGrid[r][c];
      if (!cell.isBlack && !cell.userLetter) {
        return true;
      }
    }
  }
  return false;
}

export function getFirstClueStartInDirection(direction: Direction, clues: CrosswordClue[]): { row: number; col: number; direction: Direction } | null {
  const filtered = clues.filter(c => c.direction === direction);
  if (filtered.length === 0) return null;
  const sorted = filtered.sort((a, b) => {
    if (direction === 'across') {
      return (a.row - b.row) || (a.col - b.col);
    }
    return (a.col - b.col) || (a.row - b.row);
  });
  const first = sorted[0];
  return { row: first.row, col: first.col, direction };
}

