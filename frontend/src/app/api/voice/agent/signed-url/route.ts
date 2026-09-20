import { NextRequest, NextResponse } from 'next/server';
import { BACKEND_BASE } from '@/lib/backend';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const REQUEST_TIMEOUT_MS = 12000;

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs: number) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

export async function GET(request: NextRequest) {
  try {
    // Extract language parameter from query string and forward to backend
    const language = request.nextUrl.searchParams.get('language') || 'en';
    const targetUrl = `${BACKEND_BASE}/api/voice/agent/signed-url?language=${language}`;

    const response = await fetchWithTimeout(targetUrl, {
      method: 'GET',
      headers: {
        Authorization: request.headers.get('Authorization') || 'Bearer dummy-token',
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    }, REQUEST_TIMEOUT_MS);

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Backend error: ${response.status}`, details: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Signed URL request timed out', timeout_ms: REQUEST_TIMEOUT_MS },
        { status: 504 }
      );
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: 'Internal server error', details: errorMessage },
      { status: 500 }
    );
  }
}
