import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function GET(request: Request) {
    try {
        const country =
            (request.headers.get('x-vercel-ip-country') ||
                request.headers.get('x-country') ||
                '').toUpperCase();

        return NextResponse.json({ country: country || null });
    } catch (e: any) {
        return NextResponse.json({ country: null });
    }
}
