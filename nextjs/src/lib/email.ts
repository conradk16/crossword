import { Resend } from 'resend';

export interface SendOtpEmailParams {
  to: string;
  code: string;
  expiresAt: Date;
}

// Initialize Resend client if API key is provided
const resend = process.env.RESEND_KEY ? new Resend(process.env.RESEND_KEY) : null;
const RESEND_FROM = 'no-reply@conradscrossword.com'

export async function sendOtpEmail(params: SendOtpEmailParams) {
  const { to, code, expiresAt } = params;
  const subject = 'Conrad\'s Crossword One-Time Code';
  const minutesUntilExpiry = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60));
  const text = `Your one-time code is: ${code}\n\nIt expires in ${minutesUntilExpiry} minutes. If you did not request this, ignore this email.`;
  if (!resend) {
    // Fallback: log to console
    console.log('[DEV EMAIL]', { to, subject, text });
    return;
  }
  // Send email via Resend
  const { error } = await resend.emails.send({
    from: RESEND_FROM,
    to,
    subject,
    text,
  });
  if (error) {
    throw new Error(`Failed to send email via Resend: ${error.message || String(error)}`);
  }
}
