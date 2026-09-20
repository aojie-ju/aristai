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
 * The API now runs on Fargate in the new account, reached through API Gateway.
 * The environment variable still wins, so a preview deployment can point
 * somewhere else without a code change; what changed is that the fallback is
 * somewhere that will still be there tomorrow.
 */
export const BACKEND_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  'https://f5szbtswo8.execute-api.us-east-1.amazonaws.com';
