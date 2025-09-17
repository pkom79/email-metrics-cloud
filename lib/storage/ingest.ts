// Centralized helpers for the data ingest bucket name.
// Backward compatible: falls back to deprecated PREAUTH_* envs and default 'preauth-uploads'.

export function ingestBucketName(): string {
  return (
    process.env.DATA_INGEST_BUCKET ||
    process.env.PREAUTH_BUCKET ||
    'preauth-uploads'
  );
}

export function ingestBucketNamePublic(): string {
  return (
    process.env.NEXT_PUBLIC_DATA_INGEST_BUCKET ||
    (process.env as any).NEXT_PUBLIC_PREAUTH_BUCKET ||
    'preauth-uploads'
  );
}

