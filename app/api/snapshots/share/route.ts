// Dashboard sharing feature fully removed (Aug 29 2025).
// This stubbed route intentionally returns HTTP 410 Gone for all methods.
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
const gone = () => NextResponse.json({ error: 'Dashboard sharing has been removed' }, { status: 410 });
export const GET = gone;
export const POST = gone;
export const PATCH = gone;
