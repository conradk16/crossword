export type ApiEnvironment = 'local' | 'dev' | 'prod';
import { Platform } from "react-native";

const LOCAL_API_URL =
  Platform.OS === "android"
    ? "http://10.0.2.2:3000"
    : "http://localhost:3000";

function getEnv(): ApiEnvironment {
  const env = (process.env.EXPO_PUBLIC_API_ENV || 'prod').toLowerCase(); // if not defined, use prod (no need to set env variable in prod)
  if (env != 'dev' && env != 'prod' && env != 'local') {
    throw new Error("Env must be prod, local, or dev");
  }
  return env as ApiEnvironment;
}

export function getApiBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (explicit && explicit.trim().length > 0) {
    return explicit.trim().replace(/\/$/, '');
  }

  const env = getEnv();
  switch (env) {
    case 'dev':
      return 'https://conradscrossword.dev';
    case 'local':
      return LOCAL_API_URL;
    default:
      return 'https://conradscrossword.com';
  }
}

export function withBaseUrl(path: string): string {
  const base = getApiBaseUrl();
  if (!path.startsWith('/')) return `${base}/${path}`;
  return `${base}${path}`;
}


