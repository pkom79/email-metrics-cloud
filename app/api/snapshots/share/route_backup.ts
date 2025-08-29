import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
const gone = () => NextResponse.json({ error: 'Legacy snapshot sharing removed' }, { status: 410 });
export const GET = gone;
export const POST = gone;
export const PATCH = gone;
