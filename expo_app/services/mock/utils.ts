export type MockContext = {
  urlString: string;
  method: string;
  headers: Record<string, string>;
  options?: RequestInit;
  token: string;
  authHeader: string;
  currentUserId: string;
  currentUsername: string;
  originalFetch: typeof fetch;
};

export async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function parseBody<T = any>(options?: RequestInit): Promise<T | null> {
  try {
    if (!options?.body) return null;
    if (typeof options.body === 'string') return JSON.parse(options.body) as T;
    return null;
  } catch {
    return null;
  }
}

export function buildJson(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}


