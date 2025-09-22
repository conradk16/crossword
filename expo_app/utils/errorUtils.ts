export const FRIENDLY_NETWORK_MSG = "Couldn’t connect. Check your internet connection and try again.";

export function isNetworkRequestFailed(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return typeof message === 'string' && message.toLowerCase().includes('network request failed');
}

export function getFriendlyError(error: unknown, fallbackMessage: string): { message: string; isNetwork: boolean } {
  if (isNetworkRequestFailed(error)) {
    return { message: FRIENDLY_NETWORK_MSG, isNetwork: true };
  }
  const message = error instanceof Error ? error.message : fallbackMessage;
  return { message, isNetwork: false };
}


