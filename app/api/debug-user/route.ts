import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

export async function GET() {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        
        if (authError || !user) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }

        // Get user's account
        const { data: account, error: accountError } = await supabase
            .from('accounts')
            .select('id, owner_user_id, name, company')
            .eq('owner_user_id', user.id)
            .single();

        return NextResponse.json({
            user: {
                id: user.id,
                email: user.email
            },
            account: account || 'No account found',
            accountError: accountError?.message || null
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
