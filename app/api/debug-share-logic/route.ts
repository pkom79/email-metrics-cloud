import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function GET(){ return NextResponse.json({ error: 'Sharing removed' }, { status: 410 }); }
