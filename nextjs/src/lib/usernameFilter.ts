import fs from 'node:fs';
import path from 'node:path';

let cachedPatterns: string[] | null = null;

function loadPatterns(): string[] {
  if (cachedPatterns) return cachedPatterns;
  try {
    const filePath = path.join(process.cwd(), 'src', 'lib', 'usernameDisallowList.txt');
    const contents = fs.readFileSync(filePath, 'utf8');
    cachedPatterns = contents
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .map((line) => line.toLowerCase());
  } catch (_err) {
    cachedPatterns = [];
  }
  return cachedPatterns;
}

export function clearUsernameFilterCache(): void {
  cachedPatterns = null;
}

export function findDisallowedSubstring(username: string): string | null {
  const lowered = username.toLowerCase();
  for (const pattern of loadPatterns()) {
    if (lowered.includes(pattern)) {
      return pattern;
    }
  }
  return null;
}

export function isUsernameAllowed(username: string): boolean {
  return findDisallowedSubstring(username) === null;
}


