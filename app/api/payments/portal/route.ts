import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '../../../../lib/payments/stripe';
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
        if (!accountId) {
            return NextResponse.json({ error: 'Missing accountId' }, { status: 400 });
        }

        const svc = createServiceClient();
        const { data: account, error } = await svc
            .from('accounts')
            .select('id, owner_user_id, name, company, stripe_customer_id')
            .eq('id', accountId)
            .maybeSingle();
        if (error) {
            console.error('Stripe portal: account lookup failed', error);
            return NextResponse.json({ error: 'Account lookup failed' }, { status: 500 });
        }
        if (!account) {
            return NextResponse.json({ error: 'Account not found' }, { status: 404 });
        }
        const isAdmin = (user.app_metadata as any)?.role === 'admin' || (user.app_metadata as any)?.app_role === 'admin';
        if (!isAdmin && account.owner_user_id !== user.id) {
            const { data: membership, error: memberErr } = await svc
                .from('account_users')
                .select('role')
                .eq('account_id', accountId)
                .eq('user_id', user.id)
                .limit(1)
                .maybeSingle();
            if (memberErr) {
                return NextResponse.json({ error: memberErr.message || 'Only the account owner can manage billing' }, { status: 403 });
            }
            if ((membership as any)?.role !== 'owner') {
                return NextResponse.json({ error: 'Only the account owner can manage billing' }, { status: 403 });
            }
        }
        if (!account.stripe_customer_id) {
            return NextResponse.json({ error: 'No billing customer ID' }, { status: 400 });
        }

        const stripe = getStripe();
        const returnUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;
        if (!returnUrl) {
            throw new Error('NEXT_PUBLIC_APP_URL not configured');
        }
        const portalSession = await stripe.billingPortal.sessions.create({
            customer: account.stripe_customer_id,
            return_url: `${returnUrl}/billing/manage-return`,
            configuration: process.env.STRIPE_PORTAL_CONFIGURATION_ID || undefined
        });
        if (!portalSession.url) {
            return NextResponse.json({ error: 'Unable to create billing portal session' }, { status: 500 });
        }
        return NextResponse.json({ url: portalSession.url });
    } catch (err: any) {
        console.error('Stripe portal session error', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
