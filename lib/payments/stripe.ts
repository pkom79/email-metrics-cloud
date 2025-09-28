import Stripe from 'stripe';

let stripeSingleton: Stripe | null = null;

export function getStripe(): Stripe {
    if (!stripeSingleton) {
        const secret = process.env.STRIPE_SECRET_KEY;
        if (!secret) {
            const err = new Error('Stripe secret key not configured. Define STRIPE_SECRET_KEY.');
            return new Proxy({}, {
                get() {
                    throw err;
                }
            }) as Stripe;
        }
        stripeSingleton = new Stripe(secret, {
            apiVersion: '2024-04-10',
            appInfo: {
                name: 'Email Metrics',
                url: 'https://emailmetrics.io'
            }
        });
    }
    return stripeSingleton;
}

export type StripeClient = Stripe;
