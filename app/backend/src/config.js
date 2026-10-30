// Application configuration, read once from environment variables.
// In AWS these come from SSM Parameter Store (see infra/config.tf); locally from .env.

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const config = Object.freeze({
  nodeEnv,
  port: Number.parseInt(process.env.PORT ?? '8080', 10),
  mongodbUri: required('MONGODB_URI'),
  appVersion: process.env.APP_VERSION ?? 'dev',
  // Reverse proxies in front of the API: CloudFront + nginx in production, none locally.
  // Lets req.ip resolve to the real client address from X-Forwarded-For.
  trustProxyHops: Number.parseInt(process.env.TRUST_PROXY_HOPS ?? (nodeEnv === 'production' ? '2' : '0'), 10),
});
