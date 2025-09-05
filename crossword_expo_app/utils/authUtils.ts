export function getAuthHeaders(token: string | null): Record<string, string> {
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

export async function validateAuthToken(token: string | null): Promise<boolean> {
  try {
    if (!token) {
      return false;
    }
    
    const response = await fetch('/api/profile', {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    return response.ok;
  } catch {
    // Network error or other issue, assume invalid
    return false;
  }
}
