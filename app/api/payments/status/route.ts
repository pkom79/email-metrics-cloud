import { NextRequest, NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
    try {
        const user = await getServerUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const url = new URL(req.url);
        const accountId = url.searchParams.get('account_id') || '';
        if (!accountId) {
            return NextResponse.json({ error: 'Missing account_id' }, { status: 400 });
        }

        const svc = createServiceClient();
        const { data: account, error } = await svc
            .from('accounts')
            .select('id, owner_user_id, stripe_customer_id, stripe_subscription_status, stripe_current_period_end, stripe_price_id, stripe_trial_ends_at, stripe_subscription_id')
            .eq('id', accountId)
            .maybeSingle();
        if (error) {
            console.error('Stripe status: account lookup failed', error);
            return NextResponse.json({ error: 'Account lookup failed' }, { status: 500 });
        }
        if (!account) {
            return NextResponse.json({ error: 'Account not found' }, { status: 404 });
        }

        const isOwner = account.owner_user_id === user.id;
        const isAdmin = (user.user_metadata as any)?.role === 'admin' || (user.app_metadata as any)?.role === 'admin' || (user.app_metadata as any)?.app_role === 'admin';
        if (!isOwner && !isAdmin) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        return NextResponse.json({
            subscription: {
                status: account.stripe_subscription_status || 'inactive',
                currentPeriodEnd: account.stripe_current_period_end,
                trialEndsAt: account.stripe_trial_ends_at,
                priceId: account.stripe_price_id,
                subscriptionId: account.stripe_subscription_id,
                hasCustomer: !!account.stripe_customer_id
            }
        });
    } catch (err: any) {
        console.error('Stripe status error', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
