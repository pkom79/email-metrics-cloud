// Sharing removed: legacy compat CSV redirect now returns 410 Gone.
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function GET() { return NextResponse.json({ error: 'Sharing feature removed' }, { status: 410 }); }
