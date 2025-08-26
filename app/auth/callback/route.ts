import { NextRequest, NextResponse } from 'next/server';

// Simplified auth callback - only handles edge cases since email confirmation is disabled
// Most users will sign up and be immediately authenticated without needing this callback
export async function GET(request: NextRequest) {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const token_hash = url.searchParams.get('token_hash');
    const type = url.searchParams.get('type');
    const err = url.searchParams.get('error_description') || url.searchParams.get('error');

    if (err) {
        console.log('Auth callback error:', err);
        return NextResponse.redirect(new URL(`/signup?mode=signin&error=${encodeURIComponent(err)}`, url.origin));
    }

    // Handle any remaining edge cases that require code exchange
    if (code || (token_hash && type)) {
        const qs = new URLSearchParams();
        if (code) qs.set('code', code);
        if (token_hash) qs.set('token_hash', token_hash);
        if (type) qs.set('type', type);
        
        try {
            const authResp = await fetch(new URL(`/api/auth/callback?${qs.toString()}`, url.origin), {
                method: 'GET',
                headers: { 'cache-control': 'no-store' }
            });
            
            if (!authResp.ok) {
                const { error } = await authResp.json().catch(() => ({ error: 'Auth failed' }));
                return NextResponse.redirect(new URL(`/signup?mode=signin&error=${encodeURIComponent(error || 'Auth failed')}`, url.origin));
            }

            console.log('Auth callback: Code exchange successful, redirecting to dashboard');
            return NextResponse.redirect(new URL('/dashboard', url.origin));
        } catch (error) {
            console.error('Auth callback error:', error);
            return NextResponse.redirect(new URL(`/signup?mode=signin&error=${encodeURIComponent('Auth failed')}`, url.origin));
        }
    }

    // Default fallback
    return NextResponse.redirect(new URL('/signup?mode=signin', url.origin));
}

