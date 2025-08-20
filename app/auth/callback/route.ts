import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const token_hash = url.searchParams.get('token_hash');
    const type = url.searchParams.get('type');
    const err = url.searchParams.get('error_description') || url.searchParams.get('error');

    if (err) {
        return NextResponse.redirect(new URL(`/signup?mode=signin&error=${encodeURIComponent(err)}`, url.origin));
    }

    if (code || (token_hash && type)) {
        const qs = new URLSearchParams();
        if (code) qs.set('code', code);
        if (token_hash) qs.set('token_hash', token_hash);
        if (type) qs.set('type', type);
        try {
            const res = await fetch(new URL(`/api/auth/callback?${qs.toString()}`, url.origin), { method: 'GET', headers: { 'cache-control': 'no-store' } });
            if (!res.ok) {
                const { error } = await res.json().catch(() => ({ error: 'Auth failed' }));
                return NextResponse.redirect(new URL(`/signup?mode=signin&error=${encodeURIComponent(error || 'Auth failed')}`, url.origin));
            }
            // Redirect to dashboard after successful exchange
            return NextResponse.redirect(new URL('/dashboard', url.origin));
        } catch {
            return NextResponse.redirect(new URL(`/signup?mode=signin&error=${encodeURIComponent('Auth failed')}`, url.origin));
        }
    }

    return NextResponse.redirect(new URL('/signup?mode=signin', url.origin));
}

