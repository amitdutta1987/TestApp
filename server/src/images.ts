import {AwsClient} from 'aws4fetch';

/**
 * Presigned URLs for object storage.
 *
 * The app never holds storage credentials. An APK is a zip file — anything
 * embedded in it is readable by anyone who downloads it, and leaked keys are a
 * standing invitation to run up a bill on someone else's account. The Worker
 * holds the credentials and hands out URLs scoped to one object that expire.
 *
 * Works against anything speaking the S3 API. Cloudflare R2 is the default
 * choice — 10 GB free with no egress charge, on the same account as the Worker —
 * but AWS S3 and other S3-compatible services work unchanged.
 */
export interface S3Config {
  accessKeyId: string;
  secretAccessKey: string;
  /** For R2 this is "auto"; for AWS it must match the bucket's real region. */
  region: string;
  bucket: string;
  /**
   * Base URL of an S3-compatible service, e.g.
   * "https://<account-id>.r2.cloudflarestorage.com". Left empty for AWS S3,
   * which is addressed by its own hostname convention instead.
   */
  endpoint?: string;
}

/** How long a presigned URL stays usable. Long enough for a slow shop connection. */
const EXPIRY_SECONDS = 900;

/**
 * Object keys come from the client, so they are constrained here rather than
 * trusted: without this a crafted path could reach outside the image prefix.
 */
export function isSafeImageKey(key: string): boolean {
  return (
    typeof key === 'string' &&
    key.length > 0 &&
    key.length <= 256 &&
    key.startsWith('product-images/') &&
    !key.includes('..') &&
    !key.includes('//') &&
    /^[A-Za-z0-9/._-]+$/.test(key)
  );
}

function clientFor(config: S3Config): AwsClient {
  return new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: config.region,
    service: 's3',
  });
}

/**
 * Where the object lives.
 *
 * Custom endpoints (R2 and friends) are addressed path-style, with the bucket
 * as the first path segment. AWS is addressed virtual-hosted-style, with the
 * bucket in the hostname — which is why an AWS bucket name may not contain a
 * dot: the wildcard certificate covers only one label.
 */
function objectUrl(config: S3Config, key: string): string {
  const endpoint = config.endpoint?.replace(/\/+$/, '');
  return endpoint
    ? `${endpoint}/${config.bucket}/${key}`
    : `https://${config.bucket}.s3.${config.region}.amazonaws.com/${key}`;
}

async function presign(
  config: S3Config,
  key: string,
  method: 'GET' | 'PUT',
): Promise<string> {
  const signed = await clientFor(config).sign(
    new Request(`${objectUrl(config, key)}?X-Amz-Expires=${EXPIRY_SECONDS}`, {method}),
    {aws: {signQuery: true}},
  );
  return signed.url;
}

export function presignUpload(config: S3Config, key: string): Promise<string> {
  return presign(config, key, 'PUT');
}

export function presignDownload(config: S3Config, key: string): Promise<string> {
  return presign(config, key, 'GET');
}
