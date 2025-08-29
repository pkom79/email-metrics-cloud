import { NextResponse } from 'next/server';
export async function POST(){ return NextResponse.json({ error: 'Sharing removed' }, { status: 410 }); }
