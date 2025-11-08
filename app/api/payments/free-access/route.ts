import { NextRequest, NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
    try {
        const user = await getServerUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const body = await req.json().catch(() => ({}));
        const accountId = typeof body?.accountId === 'string' ? body.accountId : '';
        if (!accountId || !/^[0-9a-fA-F-]{36}$/.test(accountId)) {
            return NextResponse.json({ error: 'Invalid accountId' }, { status: 400 });
        }

        const svc = createServiceClient();
        const { data: account, error } = await svc
            .from('accounts')
            .select('id, owner_user_id, billing_mode, stripe_subscription_status')
            .eq('id', accountId)
            .maybeSingle();
        if (error) {
            console.error('Free access lookup failed', error);
            return NextResponse.json({ error: 'Account lookup failed' }, { status: 500 });
        }
        if (!account) {
            return NextResponse.json({ error: 'Account not found' }, { status: 404 });
        }
        if (account.owner_user_id !== user.id) {
            return NextResponse.json({ error: 'Only the account owner can unlock access' }, { status: 403 });
        }
        if ((account as any).billing_mode === 'admin_free') {
            return NextResponse.json({ status: 'already_free' });
        }
        if (account.stripe_subscription_status && ['active', 'trialing', 'past_due'].includes(account.stripe_subscription_status)) {
            return NextResponse.json({ error: 'Subscription already active' }, { status: 409 });
        }

        const { error: updateErr } = await svc
            .from('accounts')
            .update({
                billing_mode: 'admin_free',
                stripe_subscription_status: null,
                stripe_subscription_id: null,
                stripe_price_id: null,
                stripe_current_period_end: null,
                stripe_trial_ends_at: null
            })
            .eq('id', accountId);
        if (updateErr) {
            console.error('Free access update failed', updateErr);
            return NextResponse.json({ error: 'Failed to unlock access' }, { status: 500 });
        }

        return NextResponse.json({ status: 'granted' });
    } catch (err: any) {
        console.error('Free access error', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
