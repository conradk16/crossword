This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## OTP Authentication Endpoint

POST `/api/auth/otp/send`

Request body (JSON):
```
{ "email": "user@example.com" }
```

Behavior:
- Validates email format.
- Enforces rate limits: at least 60 seconds between requests per email, max 3 OTPs per UTC day per email.
- Generates a 6-digit numeric code (TTL 10 minutes), stores a SHA-256 hash of the code in `otp_codes`.
- Sends the code via email (or logs to console if SMTP not configured).
- Returns `{ "success": true }` on 200.
- If no resend API key is provided, simply logs the email instead.

Error status codes:
- 400 invalid email
- 429 rate limited (too soon or daily limit reached)
- 500 internal errors (including email send failure)
