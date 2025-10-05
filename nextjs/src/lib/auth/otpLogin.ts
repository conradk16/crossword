import { query } from '../db';
import { hashOtp, generateSessionToken, hashToken } from './utils';
import { addDays, startOfDay } from 'date-fns';

const MAX_ATTEMPTS_PER_DAY = 5;

export async function verifyOtpAndLogin(email: string, otp: string) {
  // Count failed attempts for today
  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1);
  const { rows: failedRows } = await query<{ count: string }>(
    `SELECT COUNT(*)::int as count FROM otp_failed_attempts WHERE email = $1 AND attempted_at >= $2 AND attempted_at < $3`,
    [email, today, tomorrow]
  );
  const failedAttempts = Number(failedRows[0]?.count || 0);
  if (failedAttempts >= MAX_ATTEMPTS_PER_DAY) {
    return {
      success: false,
      error: 'Too many failed attempts. Try again tomorrow.',
      attemptsRemaining: 0,
    };
  }
  // Find all valid OTPs for this email
  const now = new Date();
  const { rows: otps } = await query<{ code: string }>(
    `SELECT code FROM otp_codes WHERE email = $1 AND expires_at >= $2`,
    [email, now]
  );
  const hashed = hashOtp(otp, email);
  const valid = otps.some((row) => row.code === hashed);
  if (valid) {
    const token = generateSessionToken();
    const tokenHash = hashToken(token);

    // Ensure user exists and get user_id
    const { rows: userRows } = await query<{ user_id: string }>(
      `INSERT INTO users (email) VALUES ($1)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING user_id`,
      [email]
    );
    const userId = userRows[0].user_id;

    // Insert new session token (allows multiple concurrent sessions per user)
    await query(
      `INSERT INTO user_sessions (user_id, token_hash)
       VALUES ($1, $2)`,
      [userId, tokenHash]
    );

    return { success: true, token };
  } else {
    // Record failed attempt
    await query(
      `INSERT INTO otp_failed_attempts (email) VALUES ($1)`,
      [email]
    );
    return {
      success: false,
      error: 'Invalid OTP',
      attemptsRemaining: MAX_ATTEMPTS_PER_DAY - failedAttempts - 1,
    };
  }
}
