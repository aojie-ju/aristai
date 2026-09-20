'use client';

import { COGNITO_CONFIG } from './cognito-config';

// Microsoft Sign-In via Cognito Hosted UI
// This implementation is similar to google-auth.ts but for Microsoft OIDC

// Configuration - AristAI User Pool (us-east-1)

// Storage key prefix (matches Cognito SDK format)
const STORAGE_PREFIX = `CognitoIdentityServiceProvider.${COGNITO_CONFIG.CLIENT_ID}`;

// Separate prefix to track Microsoft-specific login
const MS_AUTH_MARKER = 'MicrosoftAuthUser';

// Get the callback URL based on current environment
function getRedirectUri(): string {
  if (typeof window === 'undefined') {
    return 'http://localhost:3000/oauth/callback';
  }
  return `${window.location.origin}/oauth/callback`;
}

// Generate Microsoft login URL using Cognito Hosted UI
export function getMicrosoftLoginUrl(): string {
  const redirectUri = getRedirectUri();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: COGNITO_CONFIG.CLIENT_ID,
    redirect_uri: redirectUri,
    identity_provider: 'Microsoft',
    scope: 'email openid profile',
  });

  return `https://${COGNITO_CONFIG.DOMAIN}/oauth2/authorize?${params.toString()}`;
}

// Parse JWT token to get payload
function parseJwt(token: string): any {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (e) {
    console.error('Failed to parse JWT:', e);
    return null;
  }
}

// Exchange authorization code for tokens
export async function exchangeCodeForToken(code: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const redirectUri = getRedirectUri();
  const tokenUrl = `https://${COGNITO_CONFIG.DOMAIN}/oauth2/token`;

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: COGNITO_CONFIG.CLIENT_ID,
    code: code,
    redirect_uri: redirectUri,
  });

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Token exchange failed:', errorData);
      return {
        success: false,
        error: errorData.error_description || errorData.error || 'Token exchange failed',
      };
    }

    const tokens = await response.json();

    // Store tokens in localStorage using Cognito SDK format
    storeTokens(tokens);

    return { success: true };
  } catch (error) {
    console.error('Token exchange error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error during token exchange',
    };
  }
}

// Store tokens in localStorage using Cognito SDK format
function storeTokens(tokens: {
  id_token: string;
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}): void {
  if (typeof window === 'undefined') return;

  // Parse ID token to get user info
  const idTokenPayload = parseJwt(tokens.id_token);
  if (!idTokenPayload) {
    console.error('Failed to parse ID token');
    return;
  }

  // For Microsoft federated users, cognito:username should be like "Microsoft_<sub>"
  const cognitoUsername = idTokenPayload['cognito:username'];

  // Check if this is a federated identity (Microsoft)
  const identities = idTokenPayload.identities;
  const isMicrosoftUser = identities && Array.isArray(identities) &&
    identities.some((id: any) => id.providerName === 'Microsoft');

  // Use cognito:username for Microsoft users
  let username: string;
  if (isMicrosoftUser && cognitoUsername) {
    username = cognitoUsername;
  } else if (cognitoUsername) {
    username = cognitoUsername;
  } else {
    // Fallback: create a Microsoft-prefixed username from sub
    username = `Microsoft_${idTokenPayload.sub}`;
  }

  if (!username) {
    console.error('No username found in token');
    return;
  }

  // Store in Cognito SDK format
  const userPrefix = `${STORAGE_PREFIX}.${username}`;

  localStorage.setItem(`${userPrefix}.idToken`, tokens.id_token);
  localStorage.setItem(`${userPrefix}.accessToken`, tokens.access_token);

  if (tokens.refresh_token) {
    localStorage.setItem(`${userPrefix}.refreshToken`, tokens.refresh_token);
  }

  // Store the last authenticated user
  localStorage.setItem(`${STORAGE_PREFIX}.LastAuthUser`, username);

  // Store token expiry for checking validity
  if (tokens.expires_in) {
    const expiresAt = Date.now() + tokens.expires_in * 1000;
    localStorage.setItem(`${userPrefix}.tokenExpiry`, expiresAt.toString());
  }

  // Store Microsoft auth marker to identify this as a Microsoft login
  localStorage.setItem(MS_AUTH_MARKER, username);
}

// Get the last authenticated Microsoft user from localStorage
export function getMicrosoftUsername(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(`${STORAGE_PREFIX}.LastAuthUser`);
}

// Check if user is authenticated via Microsoft (tokens exist and not expired)
export function isMicrosoftAuthenticated(): boolean {
  if (typeof window === 'undefined') return false;

  // First check if there's a Microsoft auth marker
  const msUser = localStorage.getItem(MS_AUTH_MARKER);
  if (!msUser) return false;

  const username = getMicrosoftUsername();
  if (!username) return false;

  // Verify the username matches the Microsoft auth marker
  if (username !== msUser) return false;

  const userPrefix = `${STORAGE_PREFIX}.${username}`;
  const idToken = localStorage.getItem(`${userPrefix}.idToken`);
  const accessToken = localStorage.getItem(`${userPrefix}.accessToken`);

  if (!idToken || !accessToken) return false;

  // Check token expiry
  const expiryStr = localStorage.getItem(`${userPrefix}.tokenExpiry`);
  if (expiryStr) {
    const expiry = parseInt(expiryStr, 10);
    if (Date.now() > expiry) {
      return false;
    }
  }

  // Verify token is not expired by checking exp claim
  const payload = parseJwt(idToken);
  if (payload && payload.exp) {
    const expTime = payload.exp * 1000;
    if (Date.now() > expTime) {
      return false;
    }
  }

  return true;
}

// Get user info from stored Microsoft tokens
export interface MicrosoftAuthUser {
  email: string;
  name?: string;
  sub: string;
  emailVerified?: boolean;
}

export function getMicrosoftUserInfo(): MicrosoftAuthUser | null {
  if (typeof window === 'undefined') return null;

  // Check Microsoft auth marker first
  const msUser = localStorage.getItem(MS_AUTH_MARKER);
  if (!msUser) return null;

  const username = getMicrosoftUsername();
  if (!username || username !== msUser) return null;

  const userPrefix = `${STORAGE_PREFIX}.${username}`;
  const idToken = localStorage.getItem(`${userPrefix}.idToken`);

  if (!idToken) return null;

  const payload = parseJwt(idToken);
  if (!payload) return null;

  return {
    email: payload.email,
    name: payload.name || payload['cognito:username'],
    sub: payload.sub,
    emailVerified: payload.email_verified,
  };
}

// Get ID token for API calls
export function getMicrosoftIdToken(): string | null {
  if (typeof window === 'undefined') return null;

  // Check Microsoft auth marker first
  const msUser = localStorage.getItem(MS_AUTH_MARKER);
  if (!msUser) return null;

  const username = getMicrosoftUsername();
  if (!username || username !== msUser) return null;

  const userPrefix = `${STORAGE_PREFIX}.${username}`;
  return localStorage.getItem(`${userPrefix}.idToken`);
}

// Clear all Microsoft auth tokens from localStorage
export function clearMicrosoftTokens(): void {
  if (typeof window === 'undefined') return;

  // Get the Microsoft username before clearing
  const msUser = localStorage.getItem(MS_AUTH_MARKER);

  if (msUser) {
    const userPrefix = `${STORAGE_PREFIX}.${msUser}`;
    localStorage.removeItem(`${userPrefix}.idToken`);
    localStorage.removeItem(`${userPrefix}.accessToken`);
    localStorage.removeItem(`${userPrefix}.refreshToken`);
    localStorage.removeItem(`${userPrefix}.tokenExpiry`);
  }

  // Clear the Microsoft auth marker
  localStorage.removeItem(MS_AUTH_MARKER);

  // Clear LastAuthUser only if it matches the Microsoft user
  const lastAuthUser = localStorage.getItem(`${STORAGE_PREFIX}.LastAuthUser`);
  if (lastAuthUser && lastAuthUser === msUser) {
    localStorage.removeItem(`${STORAGE_PREFIX}.LastAuthUser`);
  }
}

// Export config for reference
export { COGNITO_CONFIG };
