
import crypto from 'crypto';

export function hashOtp(code: string, email: string): string {
  // Use the same hash as when storing OTPs (code + '|' + email)
  return crypto.createHash('sha256').update(code + '|' + email).digest('hex');
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
