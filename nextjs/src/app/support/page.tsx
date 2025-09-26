/* eslint-disable react/no-unescaped-entities */
export default function SupportPage() {
  return (
    <main className="min-h-screen p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Support</h1>
      <p className="mb-4 text-black/80 dark:text-white/80">
        Need help with Conrad's Crossword? We're here to assist you!
      </p>
      <h2 className="text-xl font-medium mt-6 mb-2">Contact Support</h2>
      <p className="text-black/80 dark:text-white/80">
        For support requests, questions, or feedback, please send an email to:{" "}
        <a 
          href="mailto:support@conradscrossword.com" 
          className="underline hover:no-underline text-blue-600 dark:text-blue-400"
        >
          support@conradscrossword.com
        </a>
      </p>
    </main>
  );
}
