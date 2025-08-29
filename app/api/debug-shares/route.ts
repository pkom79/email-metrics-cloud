import { NextResponse } from 'next/server';
export async function GET(){ return NextResponse.json({ error: 'Sharing removed' }, { status: 410 }); }
