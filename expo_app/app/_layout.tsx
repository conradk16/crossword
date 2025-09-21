import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/useColorScheme';
import { initializeState, sync, subscribeToState, getAuthState } from '@/services/state';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });
  const [stateInitialized, setStateInitialized] = useState(false);

  // No mock API; real server is used via absolute base URL

  // Initialize state once
  useEffect(() => {
    let mounted = true;
    (async () => {
      await initializeState();
      if (mounted) setStateInitialized(true);
    })();
    return () => { mounted = false; };
  }, []);

  // Set up sync interval
  useEffect(() => {
    const interval = setInterval(() => {
      sync();
    }, 10000); // 10 seconds

    return () => clearInterval(interval);
  }, []);

  if (!loaded || !stateInitialized) {
    // Wait for fonts to load and state to initialize before rendering the app.
    return null;
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="+not-found" />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
