import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';
import { Text as RNText, TextInput as RNTextInput } from 'react-native';
import { AuthProvider } from '@/services/AuthContext';
import { FriendRequestCountProvider } from '@/services/FriendRequestCountContext';
import * as SplashScreen from 'expo-splash-screen';

// prevent splash screen from autohiding (hide in index.tsx)
SplashScreen.preventAutoHideAsync();

// Disable dynamic text scaling globally
(RNText as any).defaultProps = (RNText as any).defaultProps || {};
(RNText as any).defaultProps.allowFontScaling = false;
(RNTextInput as any).defaultProps = (RNTextInput as any).defaultProps || {};
(RNTextInput as any).defaultProps.allowFontScaling = false;

export default function RootLayout() {
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  if (!loaded) {
    // Wait for fonts to load before rendering the app.
    return null;
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <FriendRequestCountProvider>
          <ThemeProvider value={DefaultTheme}>
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="+not-found" />
            </Stack>
            <StatusBar style="dark" />
          </ThemeProvider>
        </FriendRequestCountProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
