import React, { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { loadStoredAuthToken, saveStoredAuthToken, clearStoredAuthToken } from '@/services/storage';

export type AuthContextValue = {
  token: string | null;
  setAuthToken: (token: string) => Promise<void>;
  clearAuthToken: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const t = await loadStoredAuthToken();
        setToken(t);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const handleSetAuthToken = useMemo(() => async (newToken: string) => {
    await saveStoredAuthToken(newToken);
    setToken(newToken);
  }, []);

  const handleClearAuthToken = useMemo(() => async () => {
    await clearStoredAuthToken();
    setToken(null);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    token,
    setAuthToken: handleSetAuthToken,
    clearAuthToken: handleClearAuthToken,
  }), [token, handleSetAuthToken, handleClearAuthToken]);

  if (!loaded) {
    return null;
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
} 