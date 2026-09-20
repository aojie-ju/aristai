/**
 * Where this app's backend lives. One line, one place.
 *
 * Five server routes each carried their own copy of
 *   process.env.NEXT_PUBLIC_API_URL || 'http://ec2-13-219-204-7.compute-1.amazonaws.com:8000'
 * — a hard-coded fallback to an EC2 box in the AWS account being shut down,
 * over plain HTTP, by public hostname. Five copies of one fact is how half of
 * them get updated and the other half keep working until the day the box goes
 * away, which is exactly the migration this file exists for.
 *
 * WHY THE ENVIRONMENT VARIABLE IS FILTERED RATHER THAN TRUSTED.
 *
 * Changing the fallback was not enough: NEXT_PUBLIC_API_URL is set in this
 * project's Vercel settings to that same EC2 host, so it won. Proven rather
 * than assumed — a request to forum.aristai.io carrying a unique marker showed
 * up twice in the old box's own container log, minutes after this app had been
 * redeployed with the new default.
 *
 * That variable is not configuration any more, it is a stale pointer at a
 * machine that is being switched off, and after the shutdown it would take
 * Forum's whole server side with it. Silently ignoring configuration is its own
 * bad habit, so the rule is narrow and says what it is: an override is honoured
 * unless it names the decommissioned host. A preview deployment pointing
 * somewhere else still works.
 *
 * The Vercel variable should still be cleared or repointed; this only means
 * the application is correct before anyone gets to it.
 */
const DECOMMISSIONED_HOST = 'ec2-13-219-204-7.compute-1.amazonaws.com';

const NEW_BASE = 'https://f5szbtswo8.execute-api.us-east-1.amazonaws.com';

const configured = process.env.NEXT_PUBLIC_API_URL;

export const BACKEND_BASE =
  configured && !configured.includes(DECOMMISSIONED_HOST) ? configured : NEW_BASE;
