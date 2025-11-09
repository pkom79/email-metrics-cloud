import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Terms & Conditions | Email Metrics',
    description: 'Terms & Conditions governing use of the Email Metrics service.'
};

export default function TermsPage() {
    return (
        <div className="prose dark:prose-invert max-w-3xl">
            <h1 className="mb-2">Terms &amp; Conditions</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">Last updated: 2025-11-09</p>
            <h2 className="mt-0">1. Acceptance of Terms</h2>
            <p className="leading-relaxed">By accessing or using Email Metrics (the &quot;Service&quot;), you agree to be bound by these Terms &amp; Conditions. If you do not agree, you must not use the Service.</p>
            <h2 className="mt-10">2. The Service</h2>
            <p className="leading-relaxed">The Service allows you to upload email performance CSV files and receive aggregated snapshot reports. We may add, change, or remove features at any time.</p>
            <h2 className="mt-10">3. Subscriptions &amp; Payment</h2>
            <ul className="list-disc pl-6">
                <li>You can unlock lifetime access by completing the required onboarding call, or enroll in a paid plan that bills immediately upon checkout.</li>
                <li>By starting a subscription you authorize recurring charges to the payment method on file. Charges are processed by our payment provider (currently Stripe).</li>
                <li>You must keep your billing details accurate and up to date and are responsible for applicable taxes, duties, or exchange fees.</li>
                <li>We may suspend or cancel access for payment failures, chargebacks, or suspected fraudulent activity.</li>
            </ul>
            <h2 className="mt-10">4. Accounts &amp; Access</h2>
            <ul className="list-disc pl-6">
                <li>You are responsible for safeguarding your credentials.</li>
                <li>You must be authorized to upload any data you submit.</li>
                <li>We may suspend accounts for suspected abuse, security risk, or legal compliance.</li>
                <li>We reserve the right to revoke access to complimentary accounts for any reason and at any time, with or without notice.</li>
                <li>Each account is intended for use with a single Klaviyo account only. Using one Email Metrics account to manage or analyze data from multiple Klaviyo accounts is not permitted and may result in immediate termination of access without notice.</li>
            </ul>
            <h2 className="mt-10">5. Acceptable Use</h2>
            <ul className="list-disc pl-6">
                <li>No uploading malware, abusive, infringing, or unlawful content.</li>
                <li>No attempts to bypass security, rate limits, or extract source code.</li>
                <li>No use of the Service for sending unsolicited commercial email.</li>
            </ul>
            <h2 className="mt-10">6. Data &amp; Privacy</h2>
            <p className="leading-relaxed">Our handling of personal data is described in the <a href="/privacy">Privacy Policy</a>. You retain ownership of your data, granting us a limited license to process it solely for providing the Service.</p>
            <h2 className="mt-10">7. Intellectual Property</h2>
            <p className="leading-relaxed">All Service code, features, and branding are owned by us or our licensors. These Terms do not grant you any rights to our trademarks or other IP except as necessary to use the Service.</p>
            <h2 className="mt-10">8. Availability &amp; Support</h2>
            <p className="leading-relaxed">We strive for high availability but provide the Service on an &quot;AS IS&quot; and &quot;AS AVAILABLE&quot; basis without uptime guarantees unless otherwise agreed in writing.</p>
            <h2 className="mt-10">9. Disclaimers</h2>
            <p className="leading-relaxed">The Service is provided without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, and non-infringement.</p>
            <h2 className="mt-10">10. Forecasts &amp; Performance</h2>
            <p className="leading-relaxed">Any revenue projections, lift estimates, or opportunity insights in the Service are informational models based on historical inputs you provide. They are not guarantees of future performance, and you acknowledge that actual results may differ.</p>
            <h2 className="mt-10">11. Limitation of Liability</h2>
            <p className="leading-relaxed">To the maximum extent permitted by law, our aggregate liability arising out of or relating to the Service shall not exceed the greater of (a) amounts actually paid by you to us in the 3 months preceding the claim or (b) USD $50.</p>
            <h2 className="mt-10">12. Refunds &amp; Chargebacks</h2>
            <p className="leading-relaxed">All subscription fees are non-refundable once charged. If you initiate a chargeback with your payment provider, we may suspend or terminate access to the Service while the dispute is investigated, and future access may require resolving any outstanding balances.</p>
            <h2 className="mt-10">13. Cancellation</h2>
            <p className="leading-relaxed">You can cancel at any time through the billing portal link on your account page. Cancellation stops future renewals. If you cancel after charges have posted, access continues through the end of the paid period and no further renewals will occur.</p>
            <h2 className="mt-10">14. Indemnification</h2>
            <p className="leading-relaxed">You agree to indemnify and hold us harmless from claims arising from your misuse of the Service or violation of these Terms.</p>
            <h2 className="mt-10">15. Termination</h2>
            <p className="leading-relaxed">You may stop using the Service at any time. We may suspend or terminate access with or without notice for violations or risk mitigation.</p>
            <h2 className="mt-10">16. Changes</h2>
            <p className="leading-relaxed">We may update these Terms. Material changes will be indicated by updating the &quot;Last updated&quot; date. Continued use after changes constitutes acceptance.</p>
            <h2 className="mt-10">17. Governing Law</h2>
            <p className="leading-relaxed">These Terms are governed by applicable laws of the jurisdiction in which we operate, without regard to conflict of law principles.</p>
            <h2 className="mt-10">18. Contact</h2>
            <p className="leading-relaxed">Questions or issues, including billing support, can be submitted to <a href="mailto:support@emailmetrics.io">support@emailmetrics.io</a>.</p>
        </div>
    );
}
