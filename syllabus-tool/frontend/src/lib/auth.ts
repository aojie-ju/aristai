import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  type CognitoUserSession,
} from 'amazon-cognito-identity-js';

// Cognito configuration — shared with AristAI (forum.aristai.io)
const COGNITO_CONFIG = {
  // Moved 2026-09-20 off us-east-1_61m8CDReq in the AWS account being shut
  // down, onto the pool NAC, WFP and Forum already share. One identity across
  // the products; this app's callback URLs are already on that client. These
  // are public identifiers that ship in the bundle either way, not secrets.
  REGION: 'us-east-1',
  USER_POOL_ID: 'us-east-1_dzCaMscNy',
  CLIENT_ID: '5l8hi3jdajp0igmsb6usmpa5nh',
  DOMAIN: 'aristai-auth.auth.us-east-1.amazoncognito.com',
};

const userPool = new CognitoUserPool({
  UserPoolId: COGNITO_CONFIG.USER_POOL_ID,
  ClientId: COGNITO_CONFIG.CLIENT_ID,
});

const STORAGE_PREFIX = `CognitoIdentityServiceProvider.${COGNITO_CONFIG.CLIENT_ID}`;
const GOOGLE_AUTH_MARKER = 'GoogleAuthUser';
const MS_AUTH_MARKER = 'MicrosoftAuthUser';

// --- Types ---

export interface AuthUser {
  email: string;
  name?: string;
  sub: string;
}

// --- Helpers ---

function getRedirectUri(): string {
  if (typeof window === 'undefined') return 'http://localhost:5173/oauth/callback';
  return `${window.location.origin}/oauth/callback`;
}

function parseJwt(token: string): Record<string, any> | null {
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
  } catch {
    return null;
  }
}

function isTokenExpired(idToken: string): boolean {
  const payload = parseJwt(idToken);
  if (!payload?.exp) return true;
  return Date.now() > payload.exp * 1000;
}

const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000; // 5 minutes

function isTokenNearExpiry(idToken: string): boolean {
  const payload = parseJwt(idToken);
  if (!payload?.exp) return true;
  return Date.now() > (payload.exp * 1000) - TOKEN_REFRESH_MARGIN_MS;
}

// --- Error parser ---

export function parseCognitoError(error: unknown): string {
  const err = error as Record<string, string> | undefined;
  const code = err?.code || err?.name || '';
  const message = err?.message || 'An unexpected error occurred';

  switch (code) {
    case 'UserNotFoundException':
      return 'No account found with this email address.';
    case 'NotAuthorizedException':
      return 'Incorrect email or password.';
    case 'UserNotConfirmedException':
      return 'Please verify your email address first.';
    case 'InvalidPasswordException':
      return 'Password does not meet requirements.';
    case 'LimitExceededException':
      return 'Too many attempts. Please try again later.';
    case 'NetworkError':
      return 'Network error. Please check your connection.';
    default:
      return message;
  }
}

// --- Email / password sign-in (Cognito SDK) ---

export function signIn(
  email: string,
  password: string,
): Promise<{ success: true; user: AuthUser } | { success: false; error: string }> {
  return new Promise((resolve) => {
    const cognitoUser = new CognitoUser({
      Username: email.toLowerCase(),
      Pool: userPool,
      Storage: localStorage,
    });

    const authDetails = new AuthenticationDetails({
      Username: email.toLowerCase(),
      Password: password,
    });

    cognitoUser.authenticateUser(authDetails, {
      onSuccess: (session: CognitoUserSession) => {
        const idToken = session.getIdToken().decodePayload();
        resolve({
          success: true,
          user: {
            email: idToken.email,
            name: idToken.name || idToken['cognito:username'],
            sub: idToken.sub,
          },
        });
      },
      onFailure: (err) => {
        resolve({ success: false, error: parseCognitoError(err) });
      },
      newPasswordRequired: () => {
        resolve({ success: false, error: 'Password change required. Please contact support.' });
      },
    });
  });
}

// --- Cognito SDK session check ---

function getCognitoSession(): Promise<CognitoUserSession | null> {
  return new Promise((resolve) => {
    const cognitoUser = userPool.getCurrentUser();
    if (!cognitoUser) { resolve(null); return; }

    cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) {
        resolve(null);
      } else {
        resolve(session);
      }
    });
  });
}

// --- OAuth helpers (Google / Microsoft via Cognito Hosted UI) ---

export function getGoogleLoginUrl(): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: COGNITO_CONFIG.CLIENT_ID,
    redirect_uri: getRedirectUri(),
    identity_provider: 'Google',
    scope: 'email openid profile',
  });
  return `https://${COGNITO_CONFIG.DOMAIN}/oauth2/authorize?${params.toString()}`;
}

export function getMicrosoftLoginUrl(): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: COGNITO_CONFIG.CLIENT_ID,
    redirect_uri: getRedirectUri(),
    identity_provider: 'Microsoft',
    scope: 'email openid profile',
  });
  return `https://${COGNITO_CONFIG.DOMAIN}/oauth2/authorize?${params.toString()}`;
}

// Exchange OAuth authorization code for tokens
export async function exchangeCodeForToken(code: string): Promise<{ success: boolean; error?: string }> {
  const tokenUrl = `https://${COGNITO_CONFIG.DOMAIN}/oauth2/token`;
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: COGNITO_CONFIG.CLIENT_ID,
    code,
    redirect_uri: getRedirectUri(),
  });

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return { success: false, error: errorData.error_description || errorData.error || 'Token exchange failed' };
    }

    const tokens = await response.json();
    storeOAuthTokens(tokens);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Network error during token exchange' };
  }
}

export function storeOAuthTokens(tokens: {
  id_token: string;
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}): void {
  const payload = parseJwt(tokens.id_token);
  if (!payload) return;

  const cognitoUsername: string = payload['cognito:username'] || `OAuth_${payload.sub}`;
  const identities = payload.identities as Array<{ providerName: string }> | undefined;
  const isGoogle = identities?.some((id) => id.providerName === 'Google') ?? false;
  const isMicrosoft = identities?.some((id) => id.providerName === 'Microsoft') ?? false;

  const userPrefix = `${STORAGE_PREFIX}.${cognitoUsername}`;
  localStorage.setItem(`${userPrefix}.idToken`, tokens.id_token);
  localStorage.setItem(`${userPrefix}.accessToken`, tokens.access_token);
  if (tokens.refresh_token) {
    localStorage.setItem(`${userPrefix}.refreshToken`, tokens.refresh_token);
  }
  localStorage.setItem(`${STORAGE_PREFIX}.LastAuthUser`, cognitoUsername);

  if (tokens.expires_in) {
    localStorage.setItem(`${userPrefix}.tokenExpiry`, (Date.now() + tokens.expires_in * 1000).toString());
  }

  if (isGoogle) localStorage.setItem(GOOGLE_AUTH_MARKER, cognitoUsername);
  if (isMicrosoft) localStorage.setItem(MS_AUTH_MARKER, cognitoUsername);
}

// --- OAuth session checks ---

function getOAuthUser(marker: string): AuthUser | null {
  const username = localStorage.getItem(marker);
  if (!username) return null;

  const lastAuth = localStorage.getItem(`${STORAGE_PREFIX}.LastAuthUser`);
  if (lastAuth !== username) return null;

  const userPrefix = `${STORAGE_PREFIX}.${username}`;
  const idToken = localStorage.getItem(`${userPrefix}.idToken`);
  if (!idToken || isTokenExpired(idToken)) return null;

  const payload = parseJwt(idToken);
  if (!payload) return null;

  return {
    email: payload.email,
    name: payload.name || payload['cognito:username'],
    sub: payload.sub,
  };
}

// --- OAuth token refresh ---

/** Refresh OAuth tokens using the stored refresh_token. Returns new id_token or null. */
async function refreshOAuthToken(marker: string): Promise<string | null> {
  const username = localStorage.getItem(marker);
  if (!username) return null;

  const lastAuth = localStorage.getItem(`${STORAGE_PREFIX}.LastAuthUser`);
  if (lastAuth !== username) return null;

  const userPrefix = `${STORAGE_PREFIX}.${username}`;
  const refreshToken = localStorage.getItem(`${userPrefix}.refreshToken`);
  if (!refreshToken) return null;

  try {
    const tokenUrl = `https://${COGNITO_CONFIG.DOMAIN}/oauth2/token`;
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: COGNITO_CONFIG.CLIENT_ID,
      refresh_token: refreshToken,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) return null;

    const tokens = await response.json();
    // Store refreshed tokens (refresh_token is NOT returned on refresh grants)
    localStorage.setItem(`${userPrefix}.idToken`, tokens.id_token);
    localStorage.setItem(`${userPrefix}.accessToken`, tokens.access_token);
    if (tokens.expires_in) {
      localStorage.setItem(`${userPrefix}.tokenExpiry`, (Date.now() + tokens.expires_in * 1000).toString());
    }
    return tokens.id_token;
  } catch {
    return null;
  }
}

/** Get a valid OAuth id_token, refreshing if near expiry. */
async function getValidOAuthIdToken(marker: string): Promise<string | null> {
  const username = localStorage.getItem(marker);
  if (!username) return null;

  const lastAuth = localStorage.getItem(`${STORAGE_PREFIX}.LastAuthUser`);
  if (lastAuth !== username) return null;

  const userPrefix = `${STORAGE_PREFIX}.${username}`;
  const idToken = localStorage.getItem(`${userPrefix}.idToken`);
  if (!idToken) return null;

  // Token is still fresh — return it
  if (!isTokenNearExpiry(idToken)) return idToken;

  // Token is expired or near-expiry — try to refresh
  return refreshOAuthToken(marker);
}

// --- Unified auth API ---

/** Check all auth providers (Google → Microsoft → Cognito SDK). Returns user if any session is valid. */
export async function checkAnyAuth(): Promise<AuthUser | null> {
  // 1. Google OAuth
  const googleUser = getOAuthUser(GOOGLE_AUTH_MARKER);
  if (googleUser) return googleUser;

  // 2. Microsoft OAuth
  const msUser = getOAuthUser(MS_AUTH_MARKER);
  if (msUser) return msUser;

  // 3. Cognito SDK (email/password) — getSession() auto-refreshes
  const session = await getCognitoSession();
  if (session) {
    const idToken = session.getIdToken().decodePayload();
    return {
      email: idToken.email,
      name: idToken.name || idToken['cognito:username'],
      sub: idToken.sub,
    };
  }

  return null;
}

/** Get JWT id_token from any active session, auto-refreshing if near expiry.
 *  Cognito SDK sessions are refreshed by getSession() internally.
 *  OAuth sessions (Google/Microsoft) are refreshed via the Cognito token endpoint. */
export async function getAuthIdToken(): Promise<string | null> {
  // 1. Google OAuth — with auto-refresh
  const googleToken = await getValidOAuthIdToken(GOOGLE_AUTH_MARKER);
  if (googleToken) return googleToken;

  // 2. Microsoft OAuth — with auto-refresh
  const msToken = await getValidOAuthIdToken(MS_AUTH_MARKER);
  if (msToken) return msToken;

  // 3. Cognito SDK — getSession() auto-refreshes via refresh token
  const session = await getCognitoSession();
  if (session) return session.getIdToken().getJwtToken();

  return null;
}

/** Sign out all providers and clear all tokens. */
export function signOutAll(): void {
  // Cognito SDK sign-out
  const cognitoUser = userPool.getCurrentUser();
  if (cognitoUser) cognitoUser.signOut();

  // Clear all Cognito-related storage
  for (const storage of [localStorage, sessionStorage]) {
    const keysToRemove: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && (key.startsWith('CognitoIdentityServiceProvider') || key === GOOGLE_AUTH_MARKER || key === MS_AUTH_MARKER)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => storage.removeItem(key));
  }
}
