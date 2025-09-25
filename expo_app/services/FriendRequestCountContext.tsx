import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { withBaseUrl } from '@/constants/Api';
import { useAuth } from '@/services/AuthContext';

export type FriendRequestCountContextValue = {
  count: number;
  syncFriendRequestCount: (tokenOverride?: string | null) => Promise<void>;
};

const FriendRequestCountContext = createContext<FriendRequestCountContextValue | undefined>(undefined);

export function FriendRequestCountProvider({ children }: { children: ReactNode }) {
  const { token: authToken } = useAuth();
  const [count, setCount] = useState(0);

  const syncFriendRequestCount = useCallback(async (tokenOverride?: string | null) => {
    const tokenToUse = tokenOverride ?? authToken;
    if (!tokenToUse) {
      // Do not reset here to avoid race during login; provider effect clears on logout
      return;
    }
    try {
      const headers = { Authorization: `Bearer ${tokenToUse}` };
      const requestsResponse = await fetch(withBaseUrl('/api/friends/requests'), { headers });
      if (requestsResponse.ok) {
        const incomingUsernames: string[] = await requestsResponse.json();
        setCount((incomingUsernames || []).length);
      }
    } catch {
      // Keep previous count on error
    }
  }, [authToken]);

  useEffect(() => {
    if (!authToken) {
      // Clear count when logged out
      setCount(0);
      return;
    }
    // When logged in, sync without zeroing first to avoid flicker/reset
    (async () => {
      await syncFriendRequestCount();
    })();
  }, [authToken, syncFriendRequestCount]);

  return (
    <FriendRequestCountContext.Provider value={{ count, syncFriendRequestCount }}>
      {children}
    </FriendRequestCountContext.Provider>
  );
}

export function useFriendRequestCount(): FriendRequestCountContextValue {
  const ctx = useContext(FriendRequestCountContext);
  if (!ctx) {
    throw new Error('useFriendRequestCount must be used within a FriendRequestCountProvider');
  }
  return ctx;
}


