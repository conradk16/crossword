export type ApiEnvironment = 'local' | 'dev' | 'prod';

function getEnv(): ApiEnvironment {
  const env = (process.env.EXPO_PUBLIC_API_ENV || 'prod').toLowerCase(); // if not defined, use prod (no need to set env variable in prod)
  if (env === 'dev' || env === 'prod') return env as ApiEnvironment;
  return 'local';
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
      return 'http://localhost:3000';
    default:
      return 'https://conradscrossword.com';
  }
}

export function withBaseUrl(path: string): string {
  const base = getApiBaseUrl();
  if (!path.startsWith('/')) return `${base}/${path}`;
  return `${base}${path}`;
}


