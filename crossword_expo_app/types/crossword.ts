export interface CrosswordClue {
  clue: string;
  direction: 'across' | 'down';
  row: number;
  col: number;
  length: number;
}

export interface CrosswordData {
  date: string;
  grid: (string | null)[][];
  clues: CrosswordClue[];
}

export interface CrosswordCell {
  letter: string;
  userLetter?: string;
  isBlack: boolean;
  isSelected?: boolean;
  isHighlighted?: boolean;
}

export type Direction = 'across' | 'down';

export interface GameState {
  selectedRow: number;
  selectedCol: number;
  direction: Direction;
  currentWord: {
    clue: CrosswordClue;
    cells: { row: number; col: number }[];
  } | null;
  startTime: number;
  elapsedTime: number;
}
