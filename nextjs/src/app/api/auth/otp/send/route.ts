import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import crypto from 'crypto';
import { sendOtpEmail } from '@/lib/email';
import { hashOtp } from '@/lib/auth/utils';

// Configurable constants
const OTP_LENGTH = 6;
const OTP_TTL_MINUTES = 10; // code lifetime
const MIN_REQUEST_INTERVAL_MS = 60_000; // 1 minute
const MAX_PER_DAY = 3; // per email

interface OtpRowCount { count: string }
interface OtpLatest { created_at: string }

function validateEmail(email: string): boolean {
  return /^(?:[a-zA-Z0-9_'^&+{}=#!?$%`~|-]+(?:\.[a-zA-Z0-9_'^&+{}=#!?$%`~|-]+)*|"(?:[^"]|\\")+")@(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/.test(email);
}

function generateOtp(): string {
  // Numeric code, zero padded
  const max = 10 ** OTP_LENGTH;
  const num = crypto.randomInt(0, max);
  return num.toString().padStart(OTP_LENGTH, '0');
}

// hashOtp is imported from '@/lib/auth/utils'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const email: string | undefined = body?.email?.toLowerCase();
    if (!email || !validateEmail(email)) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }

    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setUTCHours(0,0,0,0);

    // Determine last successful login (session creation) for this email
    const lastLoginRes = await query<OtpLatest>(
      `SELECT us.created_at
       FROM users u
       JOIN user_sessions us ON us.user_id = u.user_id
       WHERE u.email = $1`,
      [email]
    );
    const lastLoginAtStr = lastLoginRes.rows[0]?.created_at;
    const lastLoginAt = lastLoginAtStr ? new Date(lastLoginAtStr) : null;

    // Only count OTP sends after the last successful login, and within today
    const countWindowStart = lastLoginAt && lastLoginAt > startOfDay ? lastLoginAt : startOfDay;
    const countResult = await query<OtpRowCount>(
      `SELECT COUNT(*)::text as count FROM otp_codes WHERE email = $1 AND created_at >= $2`,
      [email, countWindowStart.toISOString()]
    );
    const sentToday = parseInt(countResult.rows[0]?.count || '0', 10);
    if (sentToday >= MAX_PER_DAY) {
      return NextResponse.json({ error: 'Daily limit reached' }, { status: 429 });
    }

    // Get latest request to enforce 1 minute interval
    const latestResult = await query<OtpLatest>(
      `SELECT created_at FROM otp_codes WHERE email = $1 AND created_at >= $2 ORDER BY created_at DESC LIMIT 1`,
      [email, (lastLoginAt ?? new Date(0)).toISOString()]
    );
    if (latestResult.rows.length) {
      const last = new Date(latestResult.rows[0].created_at).getTime();
      if (now.getTime() - last < MIN_REQUEST_INTERVAL_MS) {
        return NextResponse.json({ error: 'Too soon. Wait before requesting another code.' }, { status: 429 });
      }
    }

    const code = generateOtp();
    const hashed = hashOtp(code, email);
    const expires = new Date(now.getTime() + OTP_TTL_MINUTES * 60_000);

    await query(
      `INSERT INTO otp_codes (email, code, expires_at) VALUES ($1, $2, $3)`,
      [email, hashed, expires.toISOString()]
    );

    // Send email (non-blocking errors converted to 500 if truly fails)
    try {
      await sendOtpEmail({ to: email, code, expiresAt: expires });
    } catch (e) {
      console.error('Failed to send OTP email', e);
      return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('Unexpected error in OTP send', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
