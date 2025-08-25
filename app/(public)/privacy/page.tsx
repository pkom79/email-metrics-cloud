import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Privacy Policy | Email Metrics',
    description: 'How Email Metrics collects, uses, and protects data.'
};

export default function PrivacyPage() {
    return (
        <div className="prose dark:prose-invert max-w-3xl">
            <h1>Privacy Policy</h1>
            <p className="text-sm -mt-4 text-gray-500 dark:text-gray-400">Last updated: 2025-08-25</p>
            <h2>1. Overview</h2>
            <p>This Privacy Policy explains what data we process when you use Email Metrics, why we process it, and the choices you have.</p>
            <h2>2. Data We Collect</h2>
            <ul>
                <li><strong>Account Data:</strong> Email address and authentication identifiers.</li>
                <li><strong>Uploaded CSV Data:</strong> Email performance metrics you submit (e.g., sends, opens, clicks).</li>
                <li><strong>Technical Data:</strong> IP address (short-term for security), user agent, timestamps.</li>
                <li><strong>Derived Metrics:</strong> Aggregations generated for snapshot reports.</li>
            </ul>
            <h2>3. How We Use Data</h2>
            <ul>
                <li>Provide, operate, and improve the Service.</li>
                <li>Generate aggregate analytics and snapshots you request.</li>
                <li>Secure the Service (fraud and abuse detection).</li>
                <li>Comply with legal obligations.</li>
            </ul>
            <h2>4. Legal Bases</h2>
            <p>Where required, processing is based on performance of a contract, legitimate interests in operating the Service, and compliance with legal obligations.</p>
            <h2>5. Retention</h2>
            <p>Uploaded CSV raw files are retained only as long as needed to create derived snapshot metrics, after which they may be deleted or minimized. Aggregated metrics may be kept for historical comparison unless you request deletion.</p>
            <h2>6. Data Sharing</h2>
            <p>We do not sell personal data. Limited third-party processors (e.g., hosting, authentication) receive data strictly to provide the Service under contractual safeguards.</p>
            <h2>7. Security</h2>
            <p>We implement administrative, technical, and organizational measures appropriate to risk; however, no system is perfectly secure.</p>
            <h2>8. Your Rights</h2>
            <p>Depending on jurisdiction, you may have rights to access, rectify, delete, or port your data, or object/restrict certain processing. Contact us to exercise these rights.</p>
            <h2>9. International Transfers</h2>
            <p>Data may be processed in the country where our infrastructure or processors operate with appropriate safeguards.</p>
            <h2>10. Children</h2>
            <p>The Service is not directed to children under 16 and we do not knowingly collect their personal data.</p>
            <h2>11. Changes</h2>
            <p>We may update this Policy; continued use after updates signifies acceptance. The "Last updated" date reflects the latest revision.</p>
            <h2>12. Contact</h2>
            <p>Privacy questions: <a href="mailto:privacy@email-metrics.example">privacy@email-metrics.example</a></p>
        </div>
    );
}
