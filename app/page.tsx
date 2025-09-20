import { Suspense } from 'react';
import UploadPage from '../components/UploadPage';
import NextDynamic from 'next/dynamic';

const AuthHashHandler = NextDynamic(() => import('../components/AuthHashHandler'), { ssr: false });

export const dynamic = 'force-dynamic';

export default function Home() {
    return (
        <Suspense fallback={<div />}>
            <AuthHashHandler />
            <UploadPage />
        </Suspense>
    );
}
