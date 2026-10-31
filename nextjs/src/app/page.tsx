/* eslint-disable react/no-unescaped-entities */
export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-2xl text-center space-y-4">
        <h1 className="text-2xl font-semibold">Welcome to Conrad's Apps!</h1>
        <a
          href="https://apps.apple.com/app/id6753033018"
          className="inline-block rounded-xl bg-blue-600 px-8 py-4 text-xl font-semibold text-white hover:bg-blue-700"
        >
          Get Conrad's Crossword on the App Store
        </a>
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
          <p>
            <a href="/dailies/privacy" className="underline hover:no-underline">
              Dailies privacy policy
            </a>
          </p>
          <p>
            <a href="/dailies/support" className="underline hover:no-underline">
              Dailies support
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
