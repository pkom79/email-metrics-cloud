"use client";
import { useState } from 'react';
import { supabase } from '../../../lib/supabase/client';

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email) return;
        setSubmitting(true);
        setMessage(null);
        setError(null);
        try {
            const origin = typeof window !== 'undefined' ? window.location.origin : '';
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${origin}/auth/reset-password`
            });
            // For security, don't reveal whether the email exists; show success unless obvious client error
            if (error) {
                // Some errors we still surface (rate limits, invalid email format)
                if (/rate limit/i.test(error.message) || /invalid/i.test(error.message)) {
                    setError(error.message);
                } else {
                    setMessage('If an account exists for that email, a reset link has been sent.');
                }
            } else {
                setMessage('If an account exists for that email, a reset link has been sent.');
            }
        } catch (e: any) {
            setError(e?.message || 'Unexpected error');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="max-w-md mx-auto space-y-6">
            <h2 className="text-xl font-semibold">Forgot Password</h2>
            <p className="text-sm opacity-80">Enter your email address and we will send you a link to reset your password.</p>
            <form onSubmit={onSubmit} className="space-y-3">
                <input
                    type="email"
                    required
                    placeholder="Email address"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full px-3 py-2 rounded border bg-white dark:bg-gray-800"
                />
                <button
                    type="submit"
                    disabled={submitting || !email}
                    className={`w-full py-2 rounded bg-purple-600 text-white hover:bg-purple-700 ${submitting ? 'opacity-70 cursor-wait' : ''}`}
                >
                    {submitting ? 'Sending…' : 'Send reset link'}
                </button>
            </form>
            {message && <p className="text-sm text-green-600">{message}</p>}
            {error && <p className="text-sm text-red-500">{error}</p>}
            <p className="text-xs opacity-70">You will be redirected to a secure page to set a new password after clicking the link in the email.</p>
        </div>
    );
}
