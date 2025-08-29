// Minimal stub after removing sharing feature
'use client';
interface ShareModalProps { isOpen: boolean; onClose: () => void; }
export default function ShareModal({ isOpen, onClose }: ShareModalProps) {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50">
            <div className="bg-white dark:bg-gray-900 p-6 rounded shadow max-w-sm text-center space-y-4">
                <h2 className="text-lg font-semibold">Dashboard sharing removed</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">Public/shared dashboard links are no longer supported.</p>
                <button onClick={onClose} className="px-4 py-2 bg-purple-600 text-white rounded">Close</button>
            </div>
        </div>
    );
}
