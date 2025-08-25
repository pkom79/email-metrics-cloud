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

interface StepProps { num: number; title: string; children: React.ReactNode }

function Step({ num, title, children }: StepProps) {
    return (
        <section id={`step-${num}`} className="scroll-mt-24">
            <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-600 text-white flex items-center justify-center text-sm font-semibold shadow-sm">{num}</div>
                <div className="flex-1">
                    <h2 className="text-lg font-semibold tracking-tight mb-3">{title}</h2>
                    <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed">{children}</div>
                </div>
            </div>
        </section>
    );
}

export default function CsvExportsTutorialPage() {
    const imgCls = "w-full max-w-sm rounded-md border border-gray-200 dark:border-gray-700 shadow-sm transition-transform duration-200 ease-out hover:scale-[1.8] cursor-zoom-in origin-top-left";
    return (
        <article className="relative">
            <header className="mb-10">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-4">CSV Exports Tutorial</h1>
                <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300 max-w-2xl leading-relaxed">
                    To ensure Email Metrics processes your data correctly, prepare and export your Klaviyo CSV files exactly as outlined below. We use CSV uploads instead of an API connection because CSV handles large data sets faster and with fewer errors. For most accounts, the entire export and upload process takes under 3 minutes.
                </p>
            </header>

            <Step num={1} title="Log in to Klaviyo">
                <ul className="list-disc pl-5 space-y-1">
                    <li>Sign in to your Klaviyo account.</li>
                    <li>If you manage multiple accounts, confirm you’re in the correct one.</li>
                </ul>
            </Step>

            <StepSeparator />

            <Step num={2} title="Create a Segment of All Active Subscribers">
                <ol className="list-decimal pl-5 space-y-1">
                    <li>Go to <strong>Lists &amp; Segments</strong>.</li>
                    <li>Click <strong>Create New → Create Segment</strong>.</li>
                    <li>Name the segment (e.g., <em>Klaviyo Subscribers</em>).</li>
                    <li>Set the condition: <strong>can receive email marketing</strong>.</li>
                </ol>
                <div className="mt-3"><img src="/brand/exports_tutorial/subscribers_create_segment.png" alt="Creating a new subscribers segment in Klaviyo" className={imgCls} loading="lazy" /></div>
                <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">Note: Depending on the size of your account, Klaviyo may take some time to generate the segment. Wait until it is fully built before moving on.</p>
            </Step>

            <StepSeparator />

            <Step num={3} title="Export the Segment">
                <ol className="list-decimal pl-5 space-y-2">
                    <li>Open the segment you just created.</li>
                    <li>From inside the Segment page, go to <strong>Manage Segment → Export Segment to CSV</strong>.
                        <div className="mt-2"><img src="/brand/exports_tutorial/susbcribers_export_segment_to_csv.png" alt="Export segment to CSV in Klaviyo" className={imgCls} loading="lazy" /></div>
                    </li>
                    <li>On the Export Review screen, check <strong>Property</strong> to select all fields.
                        <div className="mt-2"><img src="/brand/exports_tutorial/subscribers_export_review.png" alt="Export review screen checking properties" className={imgCls} loading="lazy" /></div>
                    </li>
                    <li>Click <strong>Start Export</strong>.</li>
                </ol>
                <p className="mt-3">Export processing usually takes 1–2 minutes.</p>
            </Step>

            <StepSeparator />

            <Step num={4} title="Save the Exported File">
                <ul className="list-disc pl-5 space-y-2">
                    <li>If prompted with Save As, name the file something clear (e.g., <em>Klaviyo Subscribers.csv</em>) and save.</li>
                    <li>If not prompted, go to <strong>Manage Segment → View My Exports</strong>.
                        <div className="mt-2"><img src="/brand/exports_tutorial/subscribers_view_my_exports.png" alt="Viewing segment exports in Klaviyo" className={imgCls} loading="lazy" /></div>
                    </li>
                    <li>Download the file from the list of completed exports.
                        <div className="mt-2"><img src="/brand/exports_tutorial/susbcribers_download.png" alt="Downloading subscribers CSV export" className={imgCls} loading="lazy" /></div>
                    </li>
                </ul>
                <p className="mt-3">Your subscriber data is now ready. Next, export Flows.</p>
            </Step>

            <StepSeparator />

            <Step num={5} title="Export Flow Analytics">
                <ol className="list-decimal pl-5 space-y-2">
                    <li>Go to <strong>Flows</strong>.</li>
                    <li>Open <strong>Options → Export analytics</strong>.
                        <div className="mt-2"><img src="/brand/exports_tutorial/flows_export_analytics.png" alt="Export analytics option for flows" className={imgCls} loading="lazy" /></div>
                    </li>
                    <li>In the export window:
                        <ul className="list-disc pl-5 mt-1 space-y-1">
                            <li><strong>Time range:</strong> All-time</li>
                            <li><strong>Aggregate analytics by:</strong> Daily</li>
                        </ul>
                    </li>
                    <li>Click <strong>Export Analytics</strong>.
                        <div className="mt-2"><img src="/brand/exports_tutorial/flows_export_flow_analytics.png" alt="Flow analytics export window" className={imgCls} loading="lazy" /></div>
                    </li>
                    <li>Save the file as <em>Klaviyo Flows.csv</em> (or similar).</li>
                </ol>
            </Step>

            <StepSeparator />

            <Step num={6} title="Export Campaign Analytics">
                <ol className="list-decimal pl-5 space-y-2">
                    <li>Go to <strong>Campaigns</strong>.</li>
                    <li>Click the three-dot menu (⋮) next to <strong>View Library → Export analytics</strong>.
                        <div className="mt-2"><img src="/brand/exports_tutorial/campaigns_export_analytics.png" alt="Export analytics menu for campaigns" className={imgCls} loading="lazy" /></div>
                    </li>
                    <li>In the export window set <strong>Time range: All Sent Campaigns</strong>.</li>
                    <li>Click <strong>Export Analytics</strong>.
                        <div className="mt-2"><img src="/brand/exports_tutorial/campaigns_export_campaign_analytics.png" alt="Campaign analytics export window" className={imgCls} loading="lazy" /></div>
                    </li>
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
            </Step>

            <footer className="mt-16 pt-8 border-t border-gray-200 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-400">
                <p>
                    Need help? Reach out via support and include any questions about your export.
                </p>
            </footer>
        </article>
    );
}
