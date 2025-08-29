import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function GET(){ return NextResponse.json({ error: 'Sharing/CSV direct access removed' }, { status: 410 }); }
