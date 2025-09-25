// Always return 'light' to ignore system dark mode.
import { useMemo } from 'react';

export function useColorScheme(): 'light' {
  // useMemo to keep a stable reference across renders
  return useMemo(() => 'light', []);
}
