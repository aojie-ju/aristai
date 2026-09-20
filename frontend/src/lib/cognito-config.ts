/**
 * The Cognito pool this application signs in against. One place, not three.
 *
 * cognito-auth.ts, google-auth.ts and ms-auth.ts each carried their own copy of
 * these constants. Three copies of one fact is how a migration half-lands: the
 * password path moves and the Google path does not, and the failure only shows
 * up for whichever users happen to use the other button.
 *
 * MOVED 2026-09-20, from us-east-1_61m8CDReq in AWS account 318083968632 to the
 * pool NAC and WFP already use in the new account. Forum, Syllabus, NAC and WFP
 * share it deliberately — one identity across the products, so a person who
 * signs in to one is known to the others — and the app client below already
 * carries this app's callback URLs.
 *
 * These values reach the browser in the bundle either way; they are public
 * identifiers, not secrets. What matters is that there is now one of them.
 */
export const COGNITO_CONFIG = {
  REGION: 'us-east-1',
  USER_POOL_ID: 'us-east-1_dzCaMscNy',
  CLIENT_ID: '5l8hi3jdajp0igmsb6usmpa5nh',
  DOMAIN: 'aristai-auth.auth.us-east-1.amazoncognito.com',
} as const;
