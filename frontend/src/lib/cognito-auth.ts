'use client';

import { COGNITO_CONFIG } from './cognito-config';

import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
  CognitoUserSession,
  ISignUpResult,
} from 'amazon-cognito-identity-js';

// Cognito configuration - AristAI User Pool (us-east-1)

// Initialize the User Pool
const userPool = new CognitoUserPool({
  UserPoolId: COGNITO_CONFIG.USER_POOL_ID,
  ClientId: COGNITO_CONFIG.CLIENT_ID,
});

// Storage key prefix for tokens
const STORAGE_KEY = `CognitoIdentityServiceProvider.${COGNITO_CONFIG.CLIENT_ID}`;

// Types
export interface AuthUser {
  email: string;
  name?: string;
  sub: string;
  emailVerified?: boolean;
}

export interface ChallengeResult {
  challengeName: 'NEW_PASSWORD_REQUIRED' | 'SMS_MFA' | 'SOFTWARE_TOKEN_MFA' | 'MFA_SETUP';
  challengeParam?: Record<string, string>;
  cognitoUser: CognitoUser;
}

export type SignInResult =
  | { success: true; user: AuthUser }
  | { success: false; challenge: ChallengeResult }
  | { success: false; error: string };

// Error parser
export function parseCognitoError(error: any): string {
  const code = error?.code || error?.name || '';
  const message = error?.message || 'An unexpected error occurred';

  switch (code) {
    case 'UserNotFoundException':
      return 'No account found with this email address.';
    case 'NotAuthorizedException':
      return 'Incorrect email or password.';
    case 'UserNotConfirmedException':
      return 'Please verify your email address first.';
    case 'InvalidPasswordException':
      return 'Password does not meet requirements. Must be at least 8 characters with uppercase, lowercase, numbers, and special characters.';
    case 'UsernameExistsException':
      return 'An account with this email already exists.';
    case 'CodeMismatchException':
      return 'Invalid verification code. Please try again.';
    case 'ExpiredCodeException':
      return 'Verification code has expired. Please request a new one.';
    case 'LimitExceededException':
      return 'Too many attempts. Please try again later.';
    case 'InvalidParameterException':
      return message.includes('password')
        ? 'Password must be at least 8 characters with uppercase, lowercase, numbers, and special characters.'
        : message;
    case 'NetworkError':
      return 'Network error. Please check your connection.';
    default:
      return message;
  }
}

// Sign In
// Note: We always use localStorage for simplicity - "Remember Me" can control session duration
// The Cognito SDK has issues when mixing sessionStorage and localStorage
export function signIn(
  email: string,
  password: string,
  rememberMe: boolean = false
): Promise<SignInResult> {
  return new Promise((resolve) => {
    const cognitoUser = new CognitoUser({
      Username: email.toLowerCase(),
      Pool: userPool,
      // Always use localStorage - the SDK's getCurrentUser() defaults to localStorage
      // If not remembered, the session will still expire based on Cognito token expiry
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
            emailVerified: idToken.email_verified,
          },
        });
      },
      onFailure: (err) => {
        resolve({ success: false, error: parseCognitoError(err) });
      },
      newPasswordRequired: (userAttributes, requiredAttributes) => {
        resolve({
          success: false,
          challenge: {
            challengeName: 'NEW_PASSWORD_REQUIRED',
            challengeParam: userAttributes,
            cognitoUser,
          },
        });
      },
      totpRequired: () => {
        resolve({
          success: false,
          challenge: {
            challengeName: 'SOFTWARE_TOKEN_MFA',
            cognitoUser,
          },
        });
      },
      mfaRequired: () => {
        resolve({
          success: false,
          challenge: {
            challengeName: 'SMS_MFA',
            cognitoUser,
          },
        });
      },
    });
  });
}

// Complete new password challenge
export function completeNewPasswordChallenge(
  cognitoUser: CognitoUser,
  newPassword: string
): Promise<{ success: boolean; error?: string; user?: AuthUser }> {
  return new Promise((resolve) => {
    cognitoUser.completeNewPasswordChallenge(newPassword, {}, {
      onSuccess: (session: CognitoUserSession) => {
        const idToken = session.getIdToken().decodePayload();
        resolve({
          success: true,
          user: {
            email: idToken.email,
            name: idToken.name,
            sub: idToken.sub,
          },
        });
      },
      onFailure: (err) => {
        resolve({ success: false, error: parseCognitoError(err) });
      },
    });
  });
}

// Complete MFA challenge
export function completeMfaChallenge(
  cognitoUser: CognitoUser,
  code: string,
  mfaType: 'SMS_MFA' | 'SOFTWARE_TOKEN_MFA' = 'SMS_MFA'
): Promise<{ success: boolean; error?: string; user?: AuthUser }> {
  return new Promise((resolve) => {
    cognitoUser.sendMFACode(code, {
      onSuccess: (session: CognitoUserSession) => {
        const idToken = session.getIdToken().decodePayload();
        resolve({
          success: true,
          user: {
            email: idToken.email,
            name: idToken.name,
            sub: idToken.sub,
          },
        });
      },
      onFailure: (err) => {
        resolve({ success: false, error: parseCognitoError(err) });
      },
    }, mfaType);
  });
}

// Sign Up (email as username)
export function signUp(
  email: string,
  password: string,
  name?: string
): Promise<{ success: boolean; error?: string; userSub?: string }> {
  return new Promise((resolve) => {
    const attributeList: CognitoUserAttribute[] = [
      new CognitoUserAttribute({ Name: 'email', Value: email.toLowerCase() }),
    ];

    if (name) {
      attributeList.push(new CognitoUserAttribute({ Name: 'name', Value: name }));
    }

    userPool.signUp(
      email.toLowerCase(), // Username = email
      password,
      attributeList,
      [],
      (err: Error | undefined, result: ISignUpResult | undefined) => {
        if (err) {
          resolve({ success: false, error: parseCognitoError(err) });
        } else {
          resolve({ success: true, userSub: result?.userSub });
        }
      }
    );
  });
}

// Confirm Sign Up (verify email)
export function confirmSignUp(
  email: string,
  code: string
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const cognitoUser = new CognitoUser({
      Username: email.toLowerCase(),
      Pool: userPool,
    });

    cognitoUser.confirmRegistration(code, true, (err, result) => {
      if (err) {
        resolve({ success: false, error: parseCognitoError(err) });
      } else {
        resolve({ success: true });
      }
    });
  });
}

// Resend confirmation code
export function resendConfirmationCode(
  email: string
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const cognitoUser = new CognitoUser({
      Username: email.toLowerCase(),
      Pool: userPool,
    });

    cognitoUser.resendConfirmationCode((err, result) => {
      if (err) {
        resolve({ success: false, error: parseCognitoError(err) });
      } else {
        resolve({ success: true });
      }
    });
  });
}

// Forgot Password - Step 1: Send code
export function forgotPassword(
  email: string
): Promise<{ success: boolean; error?: string; deliveryDetails?: any }> {
  return new Promise((resolve) => {
    const cognitoUser = new CognitoUser({
      Username: email.toLowerCase(),
      Pool: userPool,
    });

    cognitoUser.forgotPassword({
      onSuccess: (data) => {
        resolve({ success: true, deliveryDetails: data });
      },
      onFailure: (err) => {
        resolve({ success: false, error: parseCognitoError(err) });
      },
    });
  });
}

// Forgot Password - Step 2: Confirm new password
export function confirmForgotPassword(
  email: string,
  code: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const cognitoUser = new CognitoUser({
      Username: email.toLowerCase(),
      Pool: userPool,
    });

    cognitoUser.confirmPassword(code, newPassword, {
      onSuccess: () => {
        resolve({ success: true });
      },
      onFailure: (err) => {
        resolve({ success: false, error: parseCognitoError(err) });
      },
    });
  });
}

// Sign Out
export function signOut(): void {
  const cognitoUser = userPool.getCurrentUser();
  if (cognitoUser) {
    cognitoUser.signOut();
  }
  // Clear all Cognito storage
  if (typeof window !== 'undefined') {
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith(STORAGE_KEY) || key.startsWith('CognitoIdentityServiceProvider')) {
        localStorage.removeItem(key);
      }
    });
    Object.keys(sessionStorage).forEach((key) => {
      if (key.startsWith(STORAGE_KEY) || key.startsWith('CognitoIdentityServiceProvider')) {
        sessionStorage.removeItem(key);
      }
    });
  }
}

// Get current session
export function getCurrentSession(): Promise<CognitoUserSession | null> {
  return new Promise((resolve) => {
    const cognitoUser = userPool.getCurrentUser();
    if (!cognitoUser) {
      resolve(null);
      return;
    }

    cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) {
        resolve(null);
      } else {
        resolve(session);
      }
    });
  });
}

// Get current user
export async function getCurrentUser(): Promise<AuthUser | null> {
  const session = await getCurrentSession();
  if (!session) return null;

  const idToken = session.getIdToken().decodePayload();
  return {
    email: idToken.email,
    name: idToken.name || idToken['cognito:username'],
    sub: idToken.sub,
    emailVerified: idToken.email_verified,
  };
}

// Get access token for API calls
export async function getAccessToken(): Promise<string | null> {
  const session = await getCurrentSession();
  if (!session) return null;
  return session.getAccessToken().getJwtToken();
}

// Get ID token
export async function getIdToken(): Promise<string | null> {
  const session = await getCurrentSession();
  if (!session) return null;
  return session.getIdToken().getJwtToken();
}

// Check if user is authenticated
export async function isAuthenticated(): Promise<boolean> {
  const session = await getCurrentSession();
  return session !== null && session.isValid();
}

// Export config for reference
export { COGNITO_CONFIG };
