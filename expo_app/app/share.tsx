import { Redirect } from 'expo-router';

export default function ShareRedirect() {
  // Redirect to the home tab (crossword screen)
  return <Redirect href="/(tabs)" />;
}
