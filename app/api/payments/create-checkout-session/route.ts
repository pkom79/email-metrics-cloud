import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '../../../../lib/payments/stripe';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

type Cadence = 'monthly' | 'annual';

function resolvePriceId(cadence: Cadence) {
    if (cadence === 'annual') {
        if (!process.env.STRIPE_ANNUAL_PRICE_ID) {
            throw new Error('STRIPE_ANNUAL_PRICE_ID not configured');
        }
        return process.env.STRIPE_ANNUAL_PRICE_ID;
    }
    if (!process.env.STRIPE_MONTHLY_PRICE_ID) {
        throw new Error('STRIPE_MONTHLY_PRICE_ID not configured');
    }
    return process.env.STRIPE_MONTHLY_PRICE_ID;
}

export async function POST(req: NextRequest) {
    try {
        const user = await getServerUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const body = await req.json().catch(() => ({}));
        const accountId = typeof body?.accountId === 'string' ? body.accountId : '';
        const cadence: Cadence = body?.cadence === 'annual' ? 'annual' : 'monthly';
        if (!accountId) {
            return NextResponse.json({ error: 'Missing accountId' }, { status: 400 });
        }

        const svc = createServiceClient();
        const { data: account, error } = await svc
            .from('accounts')
            .select('id, owner_user_id, name, company, stripe_customer_id, stripe_subscription_status')
            .eq('id', accountId)
            .maybeSingle();
        if (error) {
            console.error('Stripe checkout: account lookup failed', error);
            return NextResponse.json({ error: 'Account lookup failed' }, { status: 500 });
        }
        if (!account) {
            return NextResponse.json({ error: 'Account not found' }, { status: 404 });
        }
        if (account.owner_user_id !== user.id) {
            return NextResponse.json({ error: 'Only the account owner can start billing' }, { status: 403 });
        }
        if (account.stripe_subscription_status && ['active', 'trialing', 'past_due'].includes(account.stripe_subscription_status)) {
            return NextResponse.json({ error: 'Subscription already active' }, { status: 409 });
        }

        const stripe = getStripe();
        const priceId = resolvePriceId(cadence);
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;
        if (!appUrl) {
            throw new Error('NEXT_PUBLIC_APP_URL not configured');
        }

        let customerId = account.stripe_customer_id || null;
        if (!customerId) {
            const customer = await stripe.customers.create({
                email: user.email || undefined,
                name: (account.company || account.name || undefined) ?? undefined,
                metadata: {
                    account_id: account.id,
                    owner_user_id: user.id
                }
            });
            customerId = customer.id;
            await svc.from('accounts').update({ stripe_customer_id: customerId }).eq('id', account.id);
        }

        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            customer: customerId,
            billing_address_collection: 'auto',
            allow_promotion_codes: true,
            line_items: [
                {
                    price: priceId,
                    quantity: 1
                }
            ],
            subscription_data: {
                metadata: {
                    account_id: account.id,
                    cadence
                }
            },
            metadata: {
                account_id: account.id,
                cadence
            },
            success_url: `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${appUrl}/billing/cancel`
        });

        if (!session.url) {
            return NextResponse.json({ error: 'Unable to create checkout session' }, { status: 500 });
        }

        return NextResponse.json({ url: session.url });
    } catch (err: any) {
        console.error('Stripe checkout session error', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
