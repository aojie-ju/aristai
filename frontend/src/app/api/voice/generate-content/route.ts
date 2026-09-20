import { NextRequest, NextResponse } from 'next/server';
import { BACKEND_BASE } from '@/lib/backend';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60; // Content generation may take longer

// IMPORTANT: ElevenLabs Client Tools have limited tool execution time
// Keep this short to avoid agent timeout - use 45 seconds max
const REQUEST_TIMEOUT_MS = 45000;

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs: number) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const targetUrl = `${BACKEND_BASE}/api/voice/generate-content`;

    console.log('[generate-content proxy] Forwarding to:', targetUrl);
    console.log('[generate-content proxy] Body:', JSON.stringify(body));

    const response = await fetchWithTimeout(targetUrl, {
      method: 'POST',
      headers: {
        Authorization: request.headers.get('Authorization') || 'Bearer dummy-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    }, REQUEST_TIMEOUT_MS);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[generate-content proxy] Backend error:', response.status, errorText);
      return NextResponse.json(
        { error: `Backend error: ${response.status}`, details: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('[generate-content proxy] Success, tokens used:', data.tokens_used);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('[generate-content proxy] Request timed out');
      return NextResponse.json(
        { error: 'Content generation request timed out', timeout_ms: REQUEST_TIMEOUT_MS },
        { status: 504 }
      );
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[generate-content proxy] Error:', errorMessage);
    return NextResponse.json(
      { error: 'Internal server error', details: errorMessage },
      { status: 500 }
    );
  }
}
