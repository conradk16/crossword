/* eslint-disable react/no-unescaped-entities */
export default function PrivacyPage() {
  return (
    <main className="min-h-screen p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Privacy Policy</h1>
      <p className="mb-4 text-black/80 dark:text-white/80">
        Conrad's Crossword respects your privacy. This website primarily serves as an API
        server for the mobile app and collects minimal information necessary to operate the service.
      </p>
      <h2 className="text-xl font-medium mt-6 mb-2">Data We Collect</h2>
      <p className="mb-4 text-black/80 dark:text-white/80">
        We may log basic request information (such as IP address, user agent, and timestamps)
        for security and operational purposes. We do not sell your data.
      </p>
      <h2 className="text-xl font-medium mt-6 mb-2">Contact</h2>
      <p className="text-black/80 dark:text-white/80">
        If you have questions about this policy, please contact the developer.
      </p>
    </main>
  );
}


