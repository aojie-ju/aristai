'use client';

import { COGNITO_CONFIG } from './cognito-config';

// Google Sign-In via Cognito Hosted UI
// This implementation is independent from the Cognito SDK and uses localStorage directly

// Configuration - AristAI User Pool (us-east-1)

// Storage key prefix (matches Cognito SDK format)
const STORAGE_PREFIX = `CognitoIdentityServiceProvider.${COGNITO_CONFIG.CLIENT_ID}`;

// Separate prefix to track Google-specific login (to differentiate from Cognito SDK login)
const GOOGLE_AUTH_MARKER = 'GoogleAuthUser';
const MS_AUTH_MARKER = 'MicrosoftAuthUser';

// Get the callback URL based on current environment
function getRedirectUri(): string {
  if (typeof window === 'undefined') {
    return 'http://localhost:3000/oauth/callback';
  }
  return `${window.location.origin}/oauth/callback`;
}

// Generate Google login URL using Cognito Hosted UI
export function getGoogleLoginUrl(): string {
  const redirectUri = getRedirectUri();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: COGNITO_CONFIG.CLIENT_ID,
    redirect_uri: redirectUri,
    identity_provider: 'Google',
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

  // For Google federated users, cognito:username should be like "Google_<sub>"
  // We use cognito:username first to ensure Google users have a distinct username
  // This prevents collision with email/password users who use email as username
  const cognitoUsername = idTokenPayload['cognito:username'];

  // Check if this is a federated identity (Google or Microsoft)
  // Federated users have an "identities" claim in the token
  const identities = idTokenPayload.identities;
  const isGoogleUser = identities && Array.isArray(identities) &&
    identities.some((id: any) => id.providerName === 'Google');
  const isMicrosoftUser = identities && Array.isArray(identities) &&
    identities.some((id: any) => id.providerName === 'Microsoft');

  // Use cognito:username for federated users (should be "Google_xxx" or "Microsoft_xxx")
  // This ensures federated login doesn't overwrite Cognito SDK login tokens
  let username: string;
  if ((isGoogleUser || isMicrosoftUser) && cognitoUsername) {
    username = cognitoUsername; // e.g., "Google_123456789" or "Microsoft_123456789"
  } else if (cognitoUsername) {
    username = cognitoUsername;
  } else {
    // Fallback: create a prefixed username from sub
    const prefix = isGoogleUser ? 'Google' : isMicrosoftUser ? 'Microsoft' : 'Unknown';
    username = `${prefix}_${idTokenPayload.sub}`;
  }

  if (!username) {
    console.error('No username found in token');
    return;
  }

  // Store in Cognito SDK format
  // Format: CognitoIdentityServiceProvider.{clientId}.{username}.{tokenType}
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

  // Store auth marker to identify the provider
  // This helps differentiate from Cognito SDK (email/password) login
  if (isGoogleUser) {
    localStorage.setItem(GOOGLE_AUTH_MARKER, username);
  } else if (isMicrosoftUser) {
    localStorage.setItem(MS_AUTH_MARKER, username);
  }
}

// Get the last authenticated Google user from localStorage
export function getGoogleUsername(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(`${STORAGE_PREFIX}.LastAuthUser`);
}

// Check if user is authenticated via Google (tokens exist and not expired)
export function isGoogleAuthenticated(): boolean {
  if (typeof window === 'undefined') return false;

  // First check if there's a Google auth marker - this indicates Google login was used
  const googleUser = localStorage.getItem(GOOGLE_AUTH_MARKER);
  if (!googleUser) return false;

  const username = getGoogleUsername();
  if (!username) return false;

  // Verify the username matches the Google auth marker
  if (username !== googleUser) return false;

  const userPrefix = `${STORAGE_PREFIX}.${username}`;
  const idToken = localStorage.getItem(`${userPrefix}.idToken`);
  const accessToken = localStorage.getItem(`${userPrefix}.accessToken`);

  if (!idToken || !accessToken) return false;

  // Check token expiry
  const expiryStr = localStorage.getItem(`${userPrefix}.tokenExpiry`);
  if (expiryStr) {
    const expiry = parseInt(expiryStr, 10);
    if (Date.now() > expiry) {
      // Token expired - could implement refresh here
      return false;
    }
  }

  // Verify token is not expired by checking exp claim
  const payload = parseJwt(idToken);
  if (payload && payload.exp) {
    const expTime = payload.exp * 1000; // Convert to milliseconds
    if (Date.now() > expTime) {
      return false;
    }
  }

  return true;
}

// Get user info from stored Google tokens
export interface GoogleAuthUser {
  email: string;
  name?: string;
  sub: string;
  emailVerified?: boolean;
  picture?: string;
}

export function getGoogleUserInfo(): GoogleAuthUser | null {
  if (typeof window === 'undefined') return null;

  // Check Google auth marker first
  const googleUser = localStorage.getItem(GOOGLE_AUTH_MARKER);
  if (!googleUser) return null;

  const username = getGoogleUsername();
  if (!username || username !== googleUser) return null;

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
    picture: payload.picture,
  };
}

// Get access token for API calls
export function getGoogleAccessToken(): string | null {
  if (typeof window === 'undefined') return null;

  // Check Google auth marker first
  const googleUser = localStorage.getItem(GOOGLE_AUTH_MARKER);
  if (!googleUser) return null;

  const username = getGoogleUsername();
  if (!username || username !== googleUser) return null;

  const userPrefix = `${STORAGE_PREFIX}.${username}`;
  return localStorage.getItem(`${userPrefix}.accessToken`);
}

// Get ID token
export function getGoogleIdToken(): string | null {
  if (typeof window === 'undefined') return null;

  // Check Google auth marker first
  const googleUser = localStorage.getItem(GOOGLE_AUTH_MARKER);
  if (!googleUser) return null;

  const username = getGoogleUsername();
  if (!username || username !== googleUser) return null;

  const userPrefix = `${STORAGE_PREFIX}.${username}`;
  return localStorage.getItem(`${userPrefix}.idToken`);
}

// Clear all Google auth tokens from localStorage
export function clearGoogleTokens(): void {
  if (typeof window === 'undefined') return;

  // Get the Google username before clearing
  const googleUser = localStorage.getItem(GOOGLE_AUTH_MARKER);

  if (googleUser) {
    const userPrefix = `${STORAGE_PREFIX}.${googleUser}`;
    localStorage.removeItem(`${userPrefix}.idToken`);
    localStorage.removeItem(`${userPrefix}.accessToken`);
    localStorage.removeItem(`${userPrefix}.refreshToken`);
    localStorage.removeItem(`${userPrefix}.tokenExpiry`);
  }

  // Clear the Google auth marker
  localStorage.removeItem(GOOGLE_AUTH_MARKER);

  // Clear LastAuthUser only if it matches the Google user
  const lastAuthUser = localStorage.getItem(`${STORAGE_PREFIX}.LastAuthUser`);
  if (lastAuthUser && lastAuthUser === googleUser) {
    localStorage.removeItem(`${STORAGE_PREFIX}.LastAuthUser`);
  }
}

// Export config for reference
export { COGNITO_CONFIG };
