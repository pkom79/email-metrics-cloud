import { Suspense } from 'react';
import UploadPage from '../../../../components/UploadPage';

export const dynamic = 'force-dynamic';

export default function UploadStep0() {
    return (
        <Suspense fallback={<div />}>
            <UploadPage />
        </Suspense>
    );
}
