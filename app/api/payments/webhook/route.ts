import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '../../../../lib/payments/stripe';
import { createServiceClient } from '../../../../lib/supabase/server';
import Stripe from 'stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function updateAccountFromSubscription(subscription: Stripe.Subscription) {
    const svc = createServiceClient();
    let accountId = subscription.metadata?.account_id || null;
    if (!accountId) {
        const customerId = typeof subscription.customer === 'string'
            ? subscription.customer
            : subscription.customer?.id;
        if (customerId) {
            const { data } = await svc
                .from('accounts')
                .select('id')
                .eq('stripe_customer_id', customerId)
                .maybeSingle();
            accountId = data?.id || null;
        }
    }
    if (!accountId) {
        console.warn('Stripe webhook: subscription without account metadata', subscription.id);
        return;
    }
    const update: Record<string, any> = {
        stripe_subscription_status: subscription.status,
        stripe_subscription_id: subscription.id,
        stripe_price_id: subscription.items?.data?.[0]?.price?.id ?? null,
        stripe_current_period_end: subscription.current_period_end
            ? new Date(subscription.current_period_end * 1000).toISOString()
            : null,
        stripe_trial_ends_at: subscription.trial_end
            ? new Date(subscription.trial_end * 1000).toISOString()
            : null,
        stripe_customer_id: typeof subscription.customer === 'string'
            ? subscription.customer
            : subscription.customer?.id ?? null
    };
    await svc.from('accounts').update(update).eq('id', accountId);
}

export async function POST(req: NextRequest) {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
        console.error('Stripe webhook secret not configured');
        return NextResponse.json({ error: 'Webhook secret missing' }, { status: 500 });
    }
    const stripe = getStripe();

    const signature = req.headers.get('stripe-signature');
    if (!signature) {
        return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
    }
    const payload = await req.text();

    let event: Stripe.Event;
    try {
        event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (err: any) {
        console.error('Stripe webhook signature verification failed', err);
        return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object as Stripe.Checkout.Session;
                if (session.subscription) {
                    const subscription = await stripe.subscriptions.retrieve(session.subscription.toString(), {
                        expand: ['items.data.price']
                    });
                    await updateAccountFromSubscription(subscription);
                }
                break;
            }
            case 'customer.subscription.created':
            case 'customer.subscription.updated':
            case 'customer.subscription.resumed': {
                const subscription = event.data.object as Stripe.Subscription;
                await updateAccountFromSubscription(subscription);
                break;
            }
            case 'customer.subscription.deleted': {
                const subscription = event.data.object as Stripe.Subscription;
                await updateAccountFromSubscription(subscription);
                break;
            }
            case 'invoice.payment_failed': {
                const invoice = event.data.object as Stripe.Invoice;
                if (invoice.subscription) {
                    const subscription = await stripe.subscriptions.retrieve(invoice.subscription.toString(), {
                        expand: ['items.data.price']
                    });
                    await updateAccountFromSubscription(subscription);
                }
                break;
            }
            default:
                // Ignore other events for now
                break;
        }
    } catch (err: any) {
        console.error('Stripe webhook handler error', err);
        return NextResponse.json({ error: 'Webhook handler error' }, { status: 500 });
    }

    return NextResponse.json({ received: true });
}
