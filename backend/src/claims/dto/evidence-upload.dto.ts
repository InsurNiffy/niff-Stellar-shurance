/** Supported MIME types for claim evidence uploads. */
export const EVIDENCE_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
] as const;

export type EvidenceAllowedMimeType = (typeof EVIDENCE_ALLOWED_MIME_TYPES)[number];

/** Default max evidence file size (10 MB). Overridden by EVIDENCE_MAX_BYTES env var. */
export const EVIDENCE_MAX_BYTES_DEFAULT = 10 * 1024 * 1024;

/** Default per-wallet upload rate limit (5 uploads per window). */
export const EVIDENCE_UPLOAD_RATE_LIMIT_DEFAULT = 5;

/** Default rate-limit window in seconds (1 hour). */
export const EVIDENCE_UPLOAD_RATE_LIMIT_WINDOW_SECONDS_DEFAULT = 3600;

export interface EvidenceUploadResponseDto {
  cid: string;
  gatewayUrl: string;
  fileSizeBytes?: number;
  mimeType?: string;
}
