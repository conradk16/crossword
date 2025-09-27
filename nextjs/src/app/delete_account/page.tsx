/* eslint-disable react/no-unescaped-entities */
export default function DeleteAccountPage() {
    return (
      <main className="min-h-screen p-8 max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold mb-4">Delete Your Account</h1>
        <p className="mb-6 text-black/80 dark:text-white/80">
          We're sorry to see you go! We only store your email address and username, but if you
          want us to delete your account from our system, simply follow these steps:
        </p>
        
        <h2 className="text-xl font-medium mt-6 mb-3">How to Delete Your Account</h2>
        <div className="space-y-4 text-black/80 dark:text-white/80">
          <div className="border-l-4 border-blue-500 pl-4">
            <h3 className="font-medium mb-2">Step 1: Open the App</h3>
            <p>Launch Conrad's Crossword on your mobile device.</p>
          </div>
          
          <div className="border-l-4 border-blue-500 pl-4">
            <h3 className="font-medium mb-2">Step 2: Go to Settings</h3>
            <p>Tap on your profile icon or navigate to the Settings menu.</p>
          </div>
          
          <div className="border-l-4 border-blue-500 pl-4">
            <h3 className="font-medium mb-2">Step 3: Find Account Settings</h3>
            <p>Navigate to the "Account" tab.</p>
          </div>
          
          <div className="border-l-4 border-red-500 pl-4">
            <h3 className="font-medium mb-2">Step 4: Delete Account</h3>
            <p>Tap "Delete Account" and confirm your decision. <strong>This action cannot be undone.</strong></p>
          </div>
        </div>

        <h2 className="text-xl font-medium mt-8 mb-3">Need Help?</h2>
        <p className="text-black/80 dark:text-white/80">
          If you're having trouble deleting your account or have questions, please contact us at:{" "}
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
  