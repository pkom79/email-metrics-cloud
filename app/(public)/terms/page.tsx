import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Terms & Conditions | Email Metrics',
    description: 'Terms & Conditions governing use of the Email Metrics service.'
};

export default function TermsPage() {
    return (
        <div className="prose dark:prose-invert max-w-3xl">
            <h1>Terms &amp; Conditions</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Last updated: 2025-08-25</p>
            <h2>1. Acceptance of Terms</h2>
            <p>By accessing or using Email Metrics (the &quot;Service&quot;), you agree to be bound by these Terms &amp; Conditions. If you do not agree, you must not use the Service.</p>
            <h2>2. The Service</h2>
            <p>The Service allows you to upload email performance CSV files and receive aggregated snapshot reports. We may add, change, or remove features at any time.</p>
            <h2>3. Accounts &amp; Access</h2>
            <ul className="list-disc pl-6">
                <li>You are responsible for safeguarding your credentials.</li>
                <li>You must be authorized to upload any data you submit.</li>
                <li>We may suspend accounts for suspected abuse, security risk, or legal compliance.</li>
            </ul>
            <h2>4. Acceptable Use</h2>
            <ul className="list-disc pl-6">
                <li>No uploading malware, abusive, infringing, or unlawful content.</li>
                <li>No attempts to bypass security, rate limits, or extract source code.</li>
                <li>No use of the Service for sending unsolicited commercial email.</li>
            </ul>
            <h2>5. Data &amp; Privacy</h2>
            <p>Our handling of personal data is described in the <a href="/privacy">Privacy Policy</a>. You retain ownership of your data, granting us a limited license to process it solely for providing the Service.</p>
            <h2>6. Intellectual Property</h2>
            <p>All Service code, features, and branding are owned by us or our licensors. These Terms do not grant you any rights to our trademarks or other IP except as necessary to use the Service.</p>
            <h2>7. Availability &amp; Support</h2>
            <p>We strive for high availability but provide the Service on an &quot;AS IS&quot; and &quot;AS AVAILABLE&quot; basis without uptime guarantees unless otherwise agreed in writing.</p>
            <h2>8. Disclaimers</h2>
            <p>The Service is provided without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, and non-infringement.</p>
            <h2>9. Limitation of Liability</h2>
            <p>To the maximum extent permitted by law, our aggregate liability arising out of or relating to the Service shall not exceed the greater of (a) amounts actually paid by you to us in the 3 months preceding the claim or (b) USD $50.</p>
            <h2>10. Indemnification</h2>
            <p>You agree to indemnify and hold us harmless from claims arising from your misuse of the Service or violation of these Terms.</p>
            <h2>11. Termination</h2>
            <p>You may stop using the Service at any time. We may suspend or terminate access with or without notice for violations or risk mitigation.</p>
            <h2>12. Changes</h2>
            <p>We may update these Terms. Material changes will be indicated by updating the &quot;Last updated&quot; date. Continued use after changes constitutes acceptance.</p>
            <h2>13. Governing Law</h2>
            <p>These Terms are governed by applicable laws of the jurisdiction in which we operate, without regard to conflict of law principles.</p>
            <h2>14. Contact</h2>
            <p>Questions about these Terms: <a href="mailto:legal@email-metrics.example">legal@email-metrics.example</a></p>
        </div>
    );
}
