import React, { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { loadStoredAuthToken, saveStoredAuthToken, clearStoredAuthToken } from '@/services/storage';
import { withBaseUrl } from '@/constants/Api';

export type AuthContextValue = {
  token: string | null;
  setAuthToken: (token: string) => Promise<void>;
  clearAuthToken: () => Promise<void>;
  syncAuth: () => Promise<void>;
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

  const setAuthToken = useMemo(() => async (newToken: string) => {
    await saveStoredAuthToken(newToken);
    setToken(newToken);
  }, []);

  const clearAuthToken = useMemo(() => async () => {
    await clearStoredAuthToken();
    setToken(null);
  }, []);

  const syncAuth = useMemo(() => async () => {
    try {
      if (!token) return;
      const response = await fetch(withBaseUrl('/api/profile'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401) {
        await clearAuthToken();
      }
    } catch {}
  }, [token, clearAuthToken]);

  const value = useMemo<AuthContextValue>(() => ({
    token,
    setAuthToken,
    clearAuthToken,
    syncAuth,
  }), [token, setAuthToken, clearAuthToken, syncAuth]);

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