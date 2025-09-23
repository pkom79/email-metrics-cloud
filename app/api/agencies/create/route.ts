import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
export async function POST() {
  return NextResponse.json({ error: 'Agencies feature retired' }, { status: 410 });
}
