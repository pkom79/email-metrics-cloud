import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

// Session sync endpoint used by the client-side Supabase auth listener
export async function POST(request: Request) {
    const supabase = createRouteHandlerClient({ cookies });
    try {
        const { event, session } = (await request.json()) as { event?: string; session?: any };
        if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
            await supabase.auth.signOut();
        } else if (session) {
            await supabase.auth.setSession(session);
        }
        return NextResponse.json({ ok: true });
    } catch (e) {
        // Return 200 to avoid noisy client errors; body indicates failure
        return NextResponse.json({ ok: false }, { status: 200 });
    }
}
