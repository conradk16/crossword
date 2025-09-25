import React from 'react';
import { View, StyleSheet, Dimensions, TouchableOpacity } from 'react-native';
import { ThemedText } from './ThemedText';
import { ThemedView } from './ThemedView';
import { CrosswordCell } from '@/types/crossword';

interface CrosswordGridProps {
  grid: CrosswordCell[][];
  onCellPress?: (row: number, col: number) => void;
  maxSize?: number;
}

export function CrosswordGrid({ grid, onCellPress, maxSize }: CrosswordGridProps) {
  const screenWidth = Dimensions.get('window').width;
  const containerPadding = 0; // no outer padding around the grid
  const gridBorderWidth = StyleSheet.hairlineWidth;
  const cellBorderWidth = StyleSheet.hairlineWidth;
  const outerBorderExtra = 2; // extra outward thickness for black border
  
  // Calculate available space accounting for container padding
  const availableWidth = screenWidth - containerPadding;
  const requestedMaxSize = maxSize ?? 400;

  // The wrapper draws an additional black border outside the grid (outerBorderExtra on each side).
  // Ensure the entire wrapper stays within the requested max size by reserving this space.
  const wrapperSize = Math.min(availableWidth, requestedMaxSize);
  const innerGridMaxSize = wrapperSize - (outerBorderExtra * 2);

  // Calculate the grid size accounting for borders (per dimension)
  // Only inner cell borders are counted (outer cells don't have borders on outer edges)
  const innerBorderWidth = (grid.length - 1) * cellBorderWidth; // per dimension

  // Calculate grid content size (space available for cells + inner borders)
  const maxContentSize = innerGridMaxSize - (gridBorderWidth * 2);
  const cellSize = (maxContentSize - innerBorderWidth) / grid.length;

  // Final grid size includes the outer border and inner borders (per dimension)
  const finalGridSize = (cellSize * grid.length) + innerBorderWidth + (gridBorderWidth * 2);

  const renderCell = (cell: CrosswordCell, row: number, col: number) => {
    // Determine which borders to show (avoid double borders on outer edges)
    const isTopEdge = row === 0;
    const isBottomEdge = row === grid.length - 1;
    const isLeftEdge = col === 0;
    const isRightEdge = col === grid[0].length - 1;
    
    // Position cells relative to the grid's inner content box (inside the border)
    // No extra offset is needed for the grid border, as absolute positioning is
    // relative to the inner edge of the border on React Native.
    const leftPosition = (col * cellSize) + (col * cellBorderWidth);
    const topPosition = (row * cellSize) + (row * cellBorderWidth);
    
    const cellBorders = {
      // Draw only top/left borders to avoid doubled thickness between cells
      borderTopWidth: isTopEdge ? 0 : cellBorderWidth,
      borderLeftWidth: isLeftEdge ? 0 : cellBorderWidth,
    };
    
    if (cell.isBlack) {
      return (
        <View
          key={`${row}-${col}`}
          style={[
            styles.cell,
            styles.blackCell,
            cellBorders,
            {
              position: 'absolute' as const,
              left: leftPosition,
              top: topPosition,
              width: cellSize,
              height: cellSize
            }
          ]}
        />
      );
    }

    const cellStyle = [
      styles.cell,
      cellBorders,
      {
        position: 'absolute' as const,
        left: leftPosition,
        top: topPosition,
        width: cellSize,
        height: cellSize
      },
      cell.isHighlighted && styles.highlightedCell,
      cell.isSelected && styles.selectedCell,
    ].filter(Boolean);

    return (
      <TouchableOpacity
        key={`${row}-${col}`}
        style={cellStyle}
        onPress={() => onCellPress?.(row, col)}
        activeOpacity={0.7}
      >
        <ThemedText style={[styles.cellLetter, { fontSize: Math.max(16, cellSize * 0.4), lineHeight: Math.max(20, cellSize * 0.5) }]}>
          {cell.userLetter || ''}
        </ThemedText>
      </TouchableOpacity>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.borderWrapper, { width: wrapperSize, height: wrapperSize }]}>
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '100%',
            height: '100%',
            borderColor: '#000',
            borderWidth: outerBorderExtra,
          }}
        />
        <View style={[styles.grid, { width: finalGridSize, height: finalGridSize, position: 'absolute', left: outerBorderExtra, top: outerBorderExtra }]}>
          {grid.map((row, rowIndex) =>
            row.map((cell, colIndex) => renderCell(cell, rowIndex, colIndex))
          )}
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    padding: 0,
  },
  grid: {
    position: 'relative',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#333',
    backgroundColor: '#fff',
    overflow: 'hidden', // Ensure content stays within bounds
  },
  borderWrapper: {
    position: 'relative',
  },
  cell: {
    borderColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  blackCell: {
    backgroundColor: '#000',
  },
  selectedCell: {
    backgroundColor: '#b762d1',
  },
  highlightedCell: {
    backgroundColor: '#d4e9ff',
  },
  cellLetter: {
    fontWeight: 'bold',
    color: '#000',
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
    paddingTop: 0,
    paddingBottom: 0,
    marginTop: 0,
    marginBottom: 0,
  },
});


