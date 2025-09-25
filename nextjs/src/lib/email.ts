import { TransactionalEmailsApi, SendSmtpEmail } from "@getbrevo/brevo";

export interface SendOtpEmailParams {
  to: string;
  code: string;
  expiresAt: Date;
}

// Initialize Brevo client if API key is provided
let emailAPI = new TransactionalEmailsApi();
(emailAPI as any).authentications.apiKey.apiKey = process.env.BREVO_API_KEY;

export async function sendOtpEmail(params: SendOtpEmailParams) {
  const { to, code, expiresAt } = params;
  const minutesUntilExpiry = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60));
  const subject = 'Conrad\'s Crossword One-Time Code';
  const text = `Your one-time code is: ${code}\n\nIt expires in ${minutesUntilExpiry} minutes. If you did not request this, ignore this email.`;
  if (!process.env.BREVO_API_KEY) {
    // Fallback: log to console
    console.log('[DEV EMAIL]', { to, subject, text });
    return;
  }
  let message = new SendSmtpEmail();
  message.subject = subject
  message.textContent = text
  message.sender = { name: "Conrad's Crossword", email: "no-reply@conradscrossword.com" };
  message.to = [{ email: to }];


  // Send email via Brevo
  try {
    const res = await emailAPI.sendTransacEmail(message);
    console.log(JSON.stringify((res as any).body));
  } catch (err: any) {
    throw new Error(`Failed to send email via Brevo: ${err?.message || String(err)}`);
  }
}
