import { NextRequest, NextResponse } from 'next/server';

// Enhanced auth callback that (1) exchanges the auth code, then (2) proactively links any
// pre-auth uploads (from cookie) to the newly created account before redirecting.
// This reduces the race where the dashboard loads before uploads are bound.
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
            // Step 1: exchange code for session (sets auth cookie)
            const authResp = await fetch(new URL(`/api/auth/callback?${qs.toString()}`, url.origin), {
                method: 'GET',
                headers: { 'cache-control': 'no-store' }
            });
            if (!authResp.ok) {
                const { error } = await authResp.json().catch(() => ({ error: 'Auth failed' }));
                return NextResponse.redirect(new URL(`/signup?mode=signin&error=${encodeURIComponent(error || 'Auth failed')}`, url.origin));
            }

            // Step 2: attempt to link any pending uploads server-side before redirecting.
            // We need to forward both the original request cookies (which contain pending-upload-ids)
            // and any new session cookies from the auth response.
            try {
                console.log('Auth callback: Attempting to link pending uploads...');
                
                // Combine original request cookies with new session cookies
                const originalCookies = request.headers.get('cookie') || '';
                const newCookies = authResp.headers.get('set-cookie') || '';
                const combinedCookies = [originalCookies, newCookies].filter(Boolean).join('; ');
                
                console.log('Auth callback: Forwarding cookies for link-pending-uploads:', { 
                    originalCookies: originalCookies.substring(0, 100) + '...', 
                    hasPendingUploads: originalCookies.includes('pending-upload-ids'),
                    hasNewSession: newCookies.length > 0 
                });
                
                const linkResponse = await fetch(new URL('/api/auth/link-pending-uploads', url.origin), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        // Forward all cookies: original request + new session
                        ...(combinedCookies ? { 'Cookie': combinedCookies } : {})
                    },
                    body: JSON.stringify({})
                });
                
                if (!linkResponse.ok) {
                    const errorText = await linkResponse.text().catch(() => 'Unknown error');
                    console.error('Failed to link pending uploads:', linkResponse.status, errorText);
                    // Redirect to dashboard with error parameter for debugging
                    return NextResponse.redirect(new URL(`/dashboard?link_error=1&status=${linkResponse.status}`, url.origin));
                } else {
                    const result = await linkResponse.json().catch(() => ({}));
                    console.log('Successfully linked pending uploads:', result);
                }
            } catch (error) {
                console.error('Error linking pending uploads:', error);
                // Redirect to dashboard with error parameter for debugging
                return NextResponse.redirect(new URL(`/dashboard?link_error=2`, url.origin));
            }

            // Step 3: redirect to dashboard
            return NextResponse.redirect(new URL('/dashboard', url.origin));
        } catch {
            return NextResponse.redirect(new URL(`/signup?mode=signin&error=${encodeURIComponent('Auth failed')}`, url.origin));
        }
    }

    return NextResponse.redirect(new URL('/signup?mode=signin', url.origin));
}

