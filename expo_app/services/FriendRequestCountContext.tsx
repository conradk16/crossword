import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { withBaseUrl } from '@/constants/Api';
import { useAuth } from '@/services/AuthContext';

export type FriendRequestCountContextValue = {
  count: number;
  syncFriendRequestCount: () => Promise<void>;
};

const FriendRequestCountContext = createContext<FriendRequestCountContextValue | undefined>(undefined);

export function FriendRequestCountProvider({ children }: { children: ReactNode }) {
  const { token: authToken } = useAuth();
  const [count, setCount] = useState(0);

  const syncFriendRequestCount = useCallback(async () => {
    if (!authToken) {
      setCount(0);
      return;
    }
    try {
      const headers = { Authorization: `Bearer ${authToken}` };
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
    setCount(0);
    (async () => {
      await syncFriendRequestCount();
    })();
  }, [syncFriendRequestCount]);

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


