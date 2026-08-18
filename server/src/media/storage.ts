/**
 * Object storage for room photography.
 *
 * ---------------------------------------------------------------------------
 * Why presigned uploads rather than posting the file to this API
 * ---------------------------------------------------------------------------
 *
 * The browser uploads **straight to the bucket**, using a short-lived URL this
 * service signs. The photograph never passes through Express.
 *
 * That is not a micro-optimisation. Proxying uploads would mean buffering
 * multi-megabyte files in the API process — the same process that holds the
 * booking transaction — on a Railway container with a fixed memory ceiling. A
 * few concurrent uploads of hotel photography is exactly the shape of load that
 * takes the reservation engine down with it. Signing a URL costs no bandwidth
 * and no memory.
 *
 * ---------------------------------------------------------------------------
 * Why a generic S3 client
 * ---------------------------------------------------------------------------
 *
 * Nothing here names a vendor. The endpoint, bucket, credentials and public
 * origin are all configuration, so this same file talks to Cloudflare R2 today
 * and to AWS S3 behind CloudFront after the production move — no code change
 * (`deployment`). The one R2-shaped detail is `region: 'auto'`, and that is a
 * default in config.ts rather than a constant here.
 *
 * The database stores object **keys**, never absolute URLs. Moving the bucket
 * or putting a CDN in front of it is then one environment variable instead of a
 * migration over every image row.
 */
import { randomUUID } from 'node:crypto';

import { S3Client } from '@aws-sdk/client-s3';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { config, mediaUploadsEnabled } from '../config.js';

/**
 * What a browser may upload.
 *
 * An allowlist, not a blocklist. These are the formats the site actually serves
 * — the performance baseline in CLAUDE.md asks for WebP, and AVIF is strictly
 * better where it is supported. JPEG and PNG are here because that is what
 * comes off a photographer's drive, and refusing them would mean the hotel
 * cannot upload the pictures it was sent.
 *
 * SVG is deliberately absent. It is a document format that executes script, and
 * an SVG served from the media origin is a stored cross-site-scripting hole.
 */
const ALLOWED_CONTENT_TYPES = new Set([
  'image/webp',
  'image/avif',
  'image/jpeg',
  'image/png',
]);

const EXTENSIONS: Record<string, string> = {
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/** How long a signed upload URL stays valid. Long enough for a slow connection
 *  to finish a 10 MB file, short enough that a leaked URL is nearly worthless. */
const UPLOAD_URL_TTL_SECONDS = 300;

export function isAllowedContentType(contentType: string): boolean {
  return ALLOWED_CONTENT_TYPES.has(contentType);
}

export const allowedContentTypes = [...ALLOWED_CONTENT_TYPES];

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!mediaUploadsEnabled) {
    throw new Error(
      'Object storage is not configured. Set MEDIA_ENDPOINT, MEDIA_BUCKET, ' +
        'MEDIA_ACCESS_KEY_ID, MEDIA_SECRET_ACCESS_KEY and MEDIA_PUBLIC_BASE_URL.',
    );
  }

  // Built once, lazily. Constructing it at module load would make importing
  // this file fail in an environment that deliberately runs without storage.
  client ??= new S3Client({
    region: config.mediaRegion,
    endpoint: config.mediaEndpoint!,
    credentials: {
      accessKeyId: config.mediaAccessKeyId!,
      secretAccessKey: config.mediaSecretAccessKey!,
    },
    // R2 and most S3-compatible services address buckets by path rather than by
    // subdomain. Virtual-host style would resolve to a hostname that does not
    // exist on R2.
    forcePathStyle: true,
  });

  return client;
}

/**
 * Where an object lives in the bucket.
 *
 * A random UUID, not the uploaded filename. Two reasons, both real: the hotel
 * will upload `IMG_0042.jpg` more than once and the second must not silently
 * replace the first, and a user-supplied name is a path-traversal and
 * header-injection surface that is simply cheaper not to have.
 *
 * The prefix keeps the bucket browsable by a human looking for room pictures.
 */
function buildStorageKey(contentType: string): string {
  const extension = EXTENSIONS[contentType] ?? 'bin';
  return `room-types/${randomUUID()}.${extension}`;
}

export interface SignedUpload {
  /** Short-lived URL the browser PUTs the file to. */
  uploadUrl: string;
  /** The key to record once the upload succeeds. */
  storageKey: string;
  expiresInSeconds: number;
}

/**
 * Sign a one-shot upload.
 *
 * `ContentType` and `ContentLength` are baked into the signature, so the
 * browser cannot present this URL and then upload something else, or something
 * larger. Without pinning both, a signed URL is an open write grant to the
 * bucket for its whole lifetime.
 */
export async function createSignedUpload(args: {
  contentType: string;
  byteSize: number;
}): Promise<SignedUpload> {
  const { contentType, byteSize } = args;

  if (!isAllowedContentType(contentType)) {
    throw new Error(`Unsupported image type: ${contentType}`);
  }
  if (byteSize <= 0 || byteSize > config.mediaMaxUploadBytes) {
    throw new Error(
      `Image must be between 1 byte and ${config.mediaMaxUploadBytes} bytes.`,
    );
  }

  const storageKey = buildStorageKey(contentType);

  const uploadUrl = await getSignedUrl(
    getClient(),
    new PutObjectCommand({
      Bucket: config.mediaBucket!,
      Key: storageKey,
      ContentType: contentType,
      ContentLength: byteSize,
    }),
    {
      expiresIn: UPLOAD_URL_TTL_SECONDS,
      // `signableHeaders` is what actually enforces the two fields above.
      //
      // Putting ContentType and ContentLength on the command alone does *not*
      // bind them: by default the presigner signs only `host` and hoists the
      // rest, so the URL would accept any body of any type. That was measured,
      // not assumed — a signed URL issued for image/png accepted a text/html
      // body until this option was added.
      //
      // It matters because objects are served from a public origin. An upload
      // URL that does not pin the content type is a stored-XSS hole: get a
      // signature for a PNG, send HTML, and it is hosted on the assets domain.
      // That is the same risk the SVG exclusion above exists to close.
      signableHeaders: new Set(['content-type', 'content-length']),
    },
  );

  return { uploadUrl, storageKey, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
}

/**
 * Remove an object.
 *
 * Deliberately forgiving: a missing object is a success, because the only
 * caller is "the database row is going away and the bytes should follow". If
 * the two ever disagree, the row is the thing that matters and an orphaned
 * object costs a fraction of a cent.
 */
export async function deleteObject(storageKey: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: config.mediaBucket!,
      Key: storageKey,
    }),
  );
}

/**
 * The public URL for a stored object, or null when no origin is configured.
 *
 * The single place a key becomes a URL — keeping it in one function is what
 * lets the bucket move without touching stored data.
 *
 * Nullable rather than throwing, deliberately. Serving an image needs only the
 * public origin, not the credentials, so this is reachable in configurations
 * where uploading is not. If the origin is missing, the right outcome is a room
 * type that falls back to its CSS gradient — not an exception on every read of
 * the rooms page.
 */
export function publicUrlFor(storageKey: string): string | null {
  if (!config.mediaPublicBaseUrl) return null;
  const base = config.mediaPublicBaseUrl.replace(/\/+$/, '');
  return `${base}/${storageKey}`;
}
