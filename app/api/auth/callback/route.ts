import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

export async function GET(request: Request) {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const token_hash = url.searchParams.get('token_hash');
    const type = url.searchParams.get('type');

    const cookieStore = await cookies();
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore });

    try {
        if (code) {
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
            return NextResponse.json({ ok: true });
        }
        if (token_hash && type) {
            const { error } = await supabase.auth.verifyOtp({ token_hash, type: type as any });
            if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
            return NextResponse.json({ ok: true });
        }
        return NextResponse.json({ ok: false, error: 'Missing parameters' }, { status: 400 });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || 'Unexpected error' }, { status: 500 });
    }
}
