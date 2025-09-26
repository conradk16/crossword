/* eslint-disable react/no-unescaped-entities */
export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-2xl text-center space-y-4">
        <h1 className="text-2xl font-semibold">Welcome to Conrad's Crossword!</h1>
        <p className="text-base text-black/80 dark:text-white/80">
          This site is simply meant as an API server for the Conrad's Crossword app.
        </p>
        <div className="space-y-2">
          <p>
            <a href="/privacy" className="underline hover:no-underline">
              Read our privacy policy
            </a>
          </p>
          <p>
            <a href="/support" className="underline hover:no-underline">
              Need support?
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
