import React, { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { withBaseUrl } from '@/constants/Api';
import { useAuth } from '@/services/AuthContext';

export type FriendRequestCountContextValue = {
  count: number;
  sync: () => Promise<void>;
};

const FriendRequestCountContext = createContext<FriendRequestCountContextValue | undefined>(undefined);

export function FriendRequestCountProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [count, setCount] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const sync = useMemo(() => async () => {
    if (!token) {
      setCount(0);
      setLoaded(true);
      return;
    }
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const requestsResponse = await fetch(withBaseUrl('/api/friends/requests'), { headers });
      const incomingUsernames: string[] = requestsResponse.ok ? await requestsResponse.json() : [];
      setCount((incomingUsernames || []).length);
    } catch {
      // Keep previous count on error
    } finally {
      setLoaded(true);
    }
  }, [token]);

  useEffect(() => {
    // Reset on token change and perform an initial sync
    setCount(0);
    (async () => {
      await sync();
    })();
  }, [token, sync]);

  const value = useMemo<FriendRequestCountContextValue>(() => ({
    count,
    sync,
  }), [count, sync]);

  if (!loaded) {
    return null;
  }

  return (
    <FriendRequestCountContext.Provider value={value}>
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


