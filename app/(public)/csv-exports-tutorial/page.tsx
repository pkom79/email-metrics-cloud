/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import React from 'react';

export const metadata = {
    title: 'CSV Exports Tutorial | Email Metrics',
    description: 'Step-by-step guide to preparing Klaviyo CSV exports for Email Metrics.'
};

function StepSeparator() {
    return <div className="my-10 h-px w-full bg-gradient-to-r from-transparent via-gray-300 dark:via-gray-700 to-transparent" />;
}

interface StepProps {
    num: number;
    title: string;
    children: React.ReactNode;
    image?: { src: string; alt: string; caption?: string }[];
}

function Step({ num, title, children, image }: StepProps) {
    return (
        <section id={`step-${num}`} className="scroll-mt-24">
            <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-600 text-white flex items-center justify-center text-sm font-semibold shadow-sm">
                    {num}
                </div>
                <div className="flex-1">
                    <h2 className="text-lg font-semibold tracking-tight mb-2">{title}</h2>
                    <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed">
                        {children}
                    </div>
                    {image && (
                        <div className="mt-4 grid gap-6 sm:grid-cols-2">
                            {image.map((img, i) => (
                                <figure key={i} className="bg-white dark:bg-gray-800/60 rounded-md border border-gray-200 dark:border-gray-700 p-3 shadow-sm">
                                    <img
                                        src={img.src}
                                        alt={img.alt}
                                        className="rounded-md ring-1 ring-gray-200 dark:ring-gray-700 w-full h-auto"
                                        loading="lazy"
                                    />
                                    {img.caption && (
                                        <figcaption className="mt-2 text-[11px] text-gray-500 dark:text-gray-400 uppercase tracking-wide font-medium">
                                            {img.caption}
                                        </figcaption>
                                    )}
                                </figure>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}

export default function CsvExportsTutorialPage() {
    return (
        <article className="relative">
            <header className="mb-10">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-4">CSV Exports Tutorial</h1>
                <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300 max-w-2xl leading-relaxed">
                    To ensure Email Metrics processes your data correctly, prepare and export your Klaviyo CSV files exactly as outlined below. We use CSV uploads instead of an API connection because CSV handles large data sets faster and with fewer errors. For most accounts, the entire export and upload process takes under 3 minutes.
                </p>
            </header>

            <nav aria-label="On this page" className="mb-8 hidden md:block">
                <ol className="flex flex-wrap gap-3 text-xs font-medium">
                    {Array.from({ length: 7 }).map((_, i) => (
                        <li key={i}>
                            <a href={`#step-${i + 1}`} className="inline-flex items-center gap-1 rounded-full bg-purple-50 dark:bg-purple-900/30 px-3 py-1 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors">
                                <span className="font-semibold">{i + 1}</span> <span className="hidden sm:inline">Step</span>
                            </a>
                        </li>
                    ))}
                </ol>
            </nav>

            <Step num={1} title="Log in to Klaviyo">
                <ul className="list-disc pl-5 space-y-1">
                    <li>Sign in to your Klaviyo account.</li>
                    <li>If you manage multiple accounts, confirm you’re in the correct one.</li>
                </ul>
            </Step>

            <StepSeparator />

            <Step
                num={2}
                title="Create a Segment of All Active Subscribers"
                image={[{
                    src: '/brand/exports_tutorial/subscribers_create_segment.png',
                    alt: 'Creating a new subscribers segment in Klaviyo',
                    caption: 'Create segment: can receive email marketing'
                }]}
            >
                <ol className="list-decimal pl-5 space-y-1">
                    <li>Go to <strong>Lists &amp; Segments</strong>.</li>
                    <li>Click <strong>Create New → Create Segment</strong>.</li>
                    <li>Name the segment (e.g., <em>Klaviyo Subscribers</em>).</li>
                    <li>Set the condition: <strong>can receive email marketing</strong>.</li>
                </ol>
                <p className="mt-3">This ensures the segment only contains non-suppressed subscribers for accurate analysis.</p>
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Note: Depending on the size of your account, Klaviyo may take some time to generate the segment. Wait until it is fully built before moving on.</p>
            </Step>

            <StepSeparator />

            <Step
                num={3}
                title="Export the Segment"
                image={[
                    { src: '/brand/exports_tutorial/susbcribers_export_segment_to_csv.png', alt: 'Export segment to CSV in Klaviyo', caption: 'Manage Segment → Export' },
                    { src: '/brand/exports_tutorial/subscribers_export_review.png', alt: 'Export review screen checking properties', caption: 'Select all Properties then Start Export' }
                ]}
            >
                <ol className="list-decimal pl-5 space-y-1">
                    <li>Open the segment you just created.</li>
                    <li>From inside the Segment page, go to <strong>Manage Segment → Export Segment to CSV</strong>.</li>
                    <li>On the Export Review screen, check <strong>Property</strong> to select all fields.</li>
                    <li>Click <strong>Start Export</strong>.</li>
                </ol>
                <p className="mt-3">Export processing usually takes 1–2 minutes.</p>
            </Step>

            <StepSeparator />

            <Step
                num={4}
                title="Save the Exported File"
                image={[
                    { src: '/brand/exports_tutorial/subscribers_view_my_exports.png', alt: 'Viewing segment exports in Klaviyo', caption: 'View My Exports' },
                    { src: '/brand/exports_tutorial/susbcribers_download.png', alt: 'Downloading subscribers CSV export', caption: 'Download completed export' }
                ]}
            >
                <ul className="list-disc pl-5 space-y-1">
                    <li>If prompted with Save As, name the file something clear (e.g., <em>Klaviyo Subscribers.csv</em>) and save.</li>
                    <li>If not prompted, go to <strong>Manage Segment → View My Exports</strong>.</li>
                    <li>Download the file from the list of completed exports.</li>
                </ul>
                <p className="mt-3">Your subscriber data is now ready. Next, export Flows.</p>
            </Step>

            <StepSeparator />

            <Step
                num={5}
                title="Export Flow Analytics"
                image={[
                    { src: '/brand/exports_tutorial/flows_export_analytics.png', alt: 'Export analytics option for flows', caption: 'Flows: Options → Export analytics' },
                    { src: '/brand/exports_tutorial/flows_export_flow_analytics.png', alt: 'Flow analytics export window', caption: 'All-time • Aggregate daily' }
                ]}
            >
                <ol className="list-decimal pl-5 space-y-1">
                    <li>Go to <strong>Flows</strong>.</li>
                    <li>Open <strong>Options → Export analytics</strong>.</li>
                    <li>In the export window set:
                        <ul className="list-disc pl-5 mt-1 space-y-1">
                            <li><strong>Time range:</strong> All-time</li>
                            <li><strong>Aggregate analytics by:</strong> Daily</li>
                        </ul>
                    </li>
                    <li>Click <strong>Export Analytics</strong>.</li>
                    <li>Save the file as <em>Klaviyo Flows.csv</em> (or similar).</li>
                </ol>
            </Step>

            <StepSeparator />

            <Step
                num={6}
                title="Export Campaign Analytics"
                image={[
                    { src: '/brand/exports_tutorial/campaigns_export_analytics.png', alt: 'Export analytics menu for campaigns', caption: 'Campaigns: Export analytics' },
                    { src: '/brand/exports_tutorial/campaigns_export_campaign_analytics.png', alt: 'Campaign analytics export window', caption: 'All Sent Campaigns' }
                ]}
            >
                <ol className="list-decimal pl-5 space-y-1">
                    <li>Go to <strong>Campaigns</strong>.</li>
                    <li>Click the three-dot menu (⋮) next to <strong>View Library → Export analytics</strong>.</li>
                    <li>In the export window set <strong>Time range: All Sent Campaigns</strong>.</li>
                    <li>Click <strong>Export Analytics</strong>.</li>
                    <li>Save the file as <em>Klaviyo Campaigns.csv</em> (or similar).</li>
                </ol>
            </Step>

            <StepSeparator />

            <Step num={7} title="Upload to Email Metrics">
                <p>Once you have all three files:</p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                    <li>Subscribers (Segment export)</li>
                    <li>Flows (Analytics export)</li>
                    <li>Campaigns (Analytics export)</li>
                </ul>
                <p className="mt-3">Return to the Email Metrics App homepage and upload your reports.</p>
                <div className="mt-5 flex flex-wrap gap-3">
                    <Link href="/" className="inline-flex items-center gap-2 rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900">Go to Homepage</Link>
                    <Link href="/upload" className="inline-flex items-center gap-2 rounded-md border border-purple-600 text-purple-700 dark:text-purple-300 px-4 py-2 text-sm font-medium hover:bg-purple-50 dark:hover:bg-purple-900/30">Upload Reports</Link>
                </div>
                <p className="mt-6 font-medium text-green-600 dark:text-green-400">You’re done.</p>
            </Step>

            <footer className="mt-16 pt-8 border-t border-gray-200 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-400">
                <p>
                    Need help? Reach out via support and include any questions about your export.
                </p>
            </footer>
        </article>
    );
}
