import { NextRequest, NextResponse } from 'next/server';
import { verifyOtpAndLogin } from '@/lib/auth/otpLogin';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = body?.email?.toLowerCase();
  const otp = body?.otp;

  if (!email || !otp) {
    return NextResponse.json({ error: 'Missing email or otp' }, { status: 400 });
  }

  const result = await verifyOtpAndLogin(email, otp);

  if (result.success) {
    return NextResponse.json({ token: result.token }, { status: 200 });
  }

  return NextResponse.json(
    { error: result.error, attemptsRemaining: result.attemptsRemaining },
    { status: 401 }
  );
}