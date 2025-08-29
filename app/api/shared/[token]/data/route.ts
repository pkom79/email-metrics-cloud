// Sharing removed: endpoint returns 410
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function GET() {
  return NextResponse.json({ error: 'Shared dashboard feature removed' }, { status: 410 });
}