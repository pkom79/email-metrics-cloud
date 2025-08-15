export default function Home() {
    return (
        <div className="space-y-4">
            <h1 className="text-2xl font-bold">Email Metrics Cloud</h1>
            <p className="text-sm opacity-80">Start by uploading your CSVs (pre-auth) or sign up to create an account.</p>
            <div className="flex gap-3">
                <a href="/(public)/upload/step-0" className="px-4 py-2 rounded bg-blue-600 text-white">Upload CSVs</a>
                <a href="/(public)/signup" className="px-4 py-2 rounded bg-gray-200 text-gray-900 dark:bg-gray-800 dark:text-gray-100">Create Account</a>
            </div>
        </div>
    );
}
