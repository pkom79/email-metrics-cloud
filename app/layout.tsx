/* eslint-disable @next/next/no-img-element */
import './globals.css';
import type { Metadata } from 'next';
import Script from 'next/script';
import ThemeToggle from '../components/ThemeToggle';
import Link from 'next/link';
import { getServerUser } from '../lib/supabase/auth';
import SupabaseAuthListener from '../components/SupabaseAuthListener';
import { AuthProvider } from '../components/AuthProvider';
import HeaderLinks from '../components/HeaderLinks';
import dynamic from 'next/dynamic';
const HeaderRoleBadge = dynamic(() => import('../components/HeaderRoleBadge'), { ssr: false });
import Footer from '../components/Footer';

export const metadata: Metadata = {
    title: 'Email Metrics',
    description: 'Upload CSVs. Get snapshots.',
    icons: {
        // Primary favicon (SVG)
        icon: [
            { url: '/icon.svg', type: 'image/svg+xml' }
        ],
        apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
    }
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
    const user = await getServerUser();
    const isAuthed = !!user;
    const isAdmin = !!user && (user as any).app_metadata?.role === 'admin';
    return (
        <html lang="en">
            <head>
                <script
                    dangerouslySetInnerHTML={{
                        __html: `!function(){try{var t=localStorage.getItem("theme");if(!t){var e=window.matchMedia("(prefers-color-scheme: dark)");t=e.matches?"dark":"light"}("dark"===t)&&document.documentElement.classList.add("dark")}catch(n){}}();`
                    }}
                />
                <link rel="icon" href="/icon.svg" type="image/svg+xml" />
                <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
                {/* Meta Pixel Code */}
                <script
                    dangerouslySetInnerHTML={{
                        __html: `!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '1970128607177135');
fbq('track', 'PageView');`
                    }}
                />
                <noscript>
                    <img height="1" width="1" style={{ display: 'none' }}
                        src="https://www.facebook.com/tr?id=1970128607177135&ev=PageView&noscript=1"
                        alt=""
                    />
                </noscript>
                {/* End Meta Pixel Code */}
            </head>
            <body className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
                <AuthProvider>
                    {/* Google Analytics */}
                    <Script src="https://www.googletagmanager.com/gtag/js?id=G-GV00VP8JZV" />
                    <Script id="google-analytics">
                        {`
                            window.dataLayer = window.dataLayer || [];
                            function gtag(){dataLayer.push(arguments);}
                            gtag('js', new Date());
                            gtag('config', 'G-GV00VP8JZV');
                        `}
                    </Script>

                    <SupabaseAuthListener />
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
                        <Link href="/" className="flex items-center gap-2 text-lg font-semibold hover:opacity-90 transition-opacity">
                            <img src="/brand/logo-email.png" alt="Email Metrics" className="h-6 w-auto" />
                            <span className="text-sm sm:text-base flex items-center gap-2">Email Metrics <HeaderRoleBadge /></span>
                        </Link>
                        <div className="flex items-center gap-3">
                            <HeaderLinks isAuthed={isAuthed} />
                            <ThemeToggle />
                        </div>
                    </div>
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">{children}</div>
                    <Footer />
                </AuthProvider>
            </body>
        </html>
    );
}
