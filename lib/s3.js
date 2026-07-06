import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";

export function getS3Config() {
  const config = {
    bucketName: String(process.env.S3_BUCKET_NAME || "").trim(),
    region: String(process.env.S3_REGION || "").trim(),
    accessKeyId: String(process.env.S3_ACCESS_KEY || "").trim(),
    secretAccessKey: String(process.env.S3_SECRET_ACCESS_KEY || "").trim(),
    publicBaseUrl: String(process.env.S3_PUBLIC_BASE_URL || "").trim().replace(/\/$/, ""),
  };

  const missing = [
    ["S3_BUCKET_NAME", config.bucketName],
    ["S3_REGION", config.region],
    ["S3_ACCESS_KEY", config.accessKeyId],
    ["S3_SECRET_ACCESS_KEY", config.secretAccessKey],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  return { config, missing };
}

export function getS3PublicUrl({ bucketName, region, publicBaseUrl }, key) {
  const encodedKey = encodeURIComponent(key);
  if (publicBaseUrl) return `${publicBaseUrl}/${encodedKey}`;
  return `https://${bucketName}.s3.${region}.amazonaws.com/${encodedKey}`;
}

export function createS3Client(s3Config) {
  return new S3Client({
    region: s3Config.region,
    credentials: {
      accessKeyId: s3Config.accessKeyId,
      secretAccessKey: s3Config.secretAccessKey,
    },
  });
}

/**
 * Extract the S3 object key from a full S3 URL.
 * Handles URLs like:
 *   https://bucket.s3.region.amazonaws.com/key
 *   https://bucket.s3.amazonaws.com/key
 *   https://custom-cdn.com/key
 */
export function extractS3KeyFromUrl(url) {
  if (!url || typeof url !== "string") return null;

  try {
    const parsed = new URL(url);
    const pathname = decodeURIComponent(parsed.pathname);
    // Remove leading slash
    const key = pathname.startsWith("/") ? pathname.slice(1) : pathname;
    return key || null;
  } catch {
    return null;
  }
}

/**
 * Delete a single S3 object by key.
 * Returns true if deleted or not found, false on unexpected error.
 */
export async function deleteS3Object(client, bucketName, key) {
  if (!key) return false;

  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      })
    );
    return true;
  } catch (err) {
    console.error(`[S3] Failed to delete key "${key}":`, err.message);
    return false;
  }
}

/**
 * Delete all S3 objects associated with a product image entry ({ full, thumb }).
 * Silently skips if URLs are missing or S3 is not configured.
 */
export async function deleteProductImage(imageEntry) {
  if (!imageEntry) return;

  const { config, missing } = getS3Config();
  if (missing.length > 0) {
    console.warn("[S3] Cannot delete images — missing config:", missing.join(", "));
    return;
  }

  const client = createS3Client(config);
  const keys = [
    extractS3KeyFromUrl(imageEntry.full),
    extractS3KeyFromUrl(imageEntry.thumb),
  ].filter(Boolean);

  await Promise.allSettled(
    keys.map((key) => deleteS3Object(client, config.bucketName, key))
  );
}

/**
 * Delete all S3 objects for an array of product image entries.
 * Best-effort: failures are logged but do not throw.
 */
export async function deleteProductImages(imagesArray) {
  if (!Array.isArray(imagesArray) || imagesArray.length === 0) return;

  const { config, missing } = getS3Config();
  if (missing.length > 0) {
    console.warn("[S3] Cannot delete images — missing config:", missing.join(", "));
    return;
  }

  const client = createS3Client(config);
  const keys = imagesArray.flatMap((entry) => [
    extractS3KeyFromUrl(entry?.full),
    extractS3KeyFromUrl(entry?.thumb),
  ]).filter(Boolean);

  if (keys.length === 0) return;

  await Promise.allSettled(
    keys.map((key) => deleteS3Object(client, config.bucketName, key))
  );

  console.log(`[S3] Deleted ${keys.length} image objects for product cleanup`);
}

/**
 * Delete an S3 object by its public URL.
 * Useful for single-URL fields like store logos.
 * Best-effort: failures are logged but do not throw.
 */
export async function deleteS3Url(url) {
  if (!url || typeof url !== "string") return;

  const { config, missing } = getS3Config();
  if (missing.length > 0) return;

  const key = extractS3KeyFromUrl(url);
  if (!key) return;

  const client = createS3Client(config);
  await deleteS3Object(client, config.bucketName, key);
}
