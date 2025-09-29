import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Privacy Policy | Email Metrics',
    description: 'How Email Metrics collects, uses, and protects data.'
};

export default function PrivacyPage() {
    return (
        <div className="prose dark:prose-invert max-w-3xl">
            <h1 className="mb-2">Privacy Policy</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">Last updated: 2025-09-16</p>
            <h2 className="mt-0">1. Overview</h2>
            <p className="leading-relaxed">This Privacy Policy explains what data we process when you use Email Metrics, why we process it, and the choices you have.</p>
            <h2 className="mt-10">2. Data We Collect</h2>
            <ul className="list-disc pl-6">
                <li><strong>Account Data:</strong> Email address and authentication identifiers.</li>
                <li><strong>Uploaded CSV Data:</strong> Email performance metrics you submit (e.g., sends, opens, clicks).</li>
                <li><strong>Technical Data:</strong> IP address (short-term for security), user agent, timestamps.</li>
                <li><strong>Derived Metrics:</strong> Aggregations generated for snapshot reports.</li>
                <li><strong>Billing Data:</strong> Subscription selections, payment method tokens, limited billing address details, and transaction metadata received from our payment processor (currently Stripe).</li>
            </ul>
            <h2 className="mt-10">3. How We Use Data</h2>
            <ul className="list-disc pl-6 leading-relaxed">
                <li>Provide, operate, and improve the Service.</li>
                <li>Generate aggregate analytics and snapshots you request.</li>
                <li>Secure the Service (fraud and abuse detection).</li>
                <li>Process payments, manage subscriptions, and communicate about billing events.</li>
                <li>Comply with legal obligations.</li>
            </ul>
            <h2 className="mt-10">4. Legal Bases</h2>
            <p className="leading-relaxed">Where required, processing is based on performance of a contract, legitimate interests in operating the Service, and compliance with legal obligations.</p>
            <h2 className="mt-10">5. Retention</h2>
            <p className="leading-relaxed">Uploaded CSV raw files are retained only as long as needed to create derived snapshot metrics, after which they may be deleted or minimized. Aggregated metrics may be kept for historical comparison unless you request deletion. Billing records are retained for the period required to satisfy accounting, audit, and tax obligations.</p>
            <h2 className="mt-10">6. Data Sharing</h2>
            <p className="leading-relaxed">We do not sell personal data. Limited third-party processors (e.g., hosting, authentication, payments) receive data strictly to provide the Service under contractual safeguards. For payment processing we use Stripe, which receives billing data needed to charge your account; see <a href="https://stripe.com/privacy" rel="noreferrer" target="_blank">Stripe&rsquo;s Privacy Policy</a> for details on their practices.</p>
            <h2 className="mt-10">7. Security</h2>
            <p className="leading-relaxed">We implement administrative, technical, and organizational measures appropriate to risk; however, no system is perfectly secure.</p>
            <h2 className="mt-10">8. Your Rights</h2>
            <p className="leading-relaxed">Depending on jurisdiction, you may have rights to access, rectify, delete, or port your data, or object/restrict certain processing. Contact us to exercise these rights. Requests to delete billing information may require coordination with our payment processor and can be limited by legal retention requirements.</p>
            <h2 className="mt-10">9. International Transfers</h2>
            <p className="leading-relaxed">Data may be processed in the country where our infrastructure or processors operate with appropriate safeguards.</p>
            <h2 className="mt-10">10. Children</h2>
            <p className="leading-relaxed">The Service is not directed to children under 16 and we do not knowingly collect their personal data.</p>
            <h2 className="mt-10">11. Changes</h2>
            <p className="leading-relaxed">We may update this Policy; continued use after updates signifies acceptance. The &quot;Last updated&quot; date reflects the latest revision.</p>
            <h2 className="mt-10">12. Contact</h2>
            <p className="leading-relaxed">Privacy questions: <a href="mailto:support@emailmetrics.io">support@emailmetrics.io</a></p>
        </div>
    );
}
