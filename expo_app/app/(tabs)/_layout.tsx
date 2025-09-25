import { Tabs } from 'expo-router';
import React from 'react';

import { IconSymbol } from '@/components/ui/IconSymbol';
import TabBarBackground from '@/components/ui/TabBarBackground';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useFriendRequestCount } from '@/services/FriendRequestCountContext';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { count: friendRequestCount } = useFriendRequestCount();

  return (
    <Tabs
      // Keep all tab scenes attached to improve instantaneous switching
      detachInactiveScreens={false}
      screenOptions={{
        // Pre-mount all tabs to avoid brief content remnants when switching
        lazy: false,
        // Prevent screens from updating while blurred to reduce flicker
        freezeOnBlur: true,
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: false,
        tabBarBackground: TabBarBackground,
        tabBarStyle: {},
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Crossword',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="puzzlepiece.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="leaderboard"
        options={{
          title: 'Leaderboard',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="trophy.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="friends"
        options={() => ({
          title: 'Friends',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="person.2.fill" color={color} />,
          tabBarBadge: friendRequestCount > 0 ? friendRequestCount : undefined,
          tabBarBadgeStyle: { backgroundColor: 'red' },
        })}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Account',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="gearshape.fill" color={color} />,
          freezeOnBlur: true,
        }}
      />
    </Tabs>
  );
}
