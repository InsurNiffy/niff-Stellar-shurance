import { getConfig } from '@/config/env';

import { IpfsUploadResponse } from '../types/claim';

export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export type ProgressCallback = (progress: UploadProgress) => void;

const { apiUrl: API_BASE_URL } = getConfig();

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Computes SHA-256 hash of the file bytes in the browser using Web Crypto API.
 */
export async function computeFileSha256Hex(file: File): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto API is unavailable in this browser');
  }

  const fileBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(fileBuffer);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(digest));
}

/**
 * Uploads a file to IPFS via the backend with progress tracking and retry logic.
 */
export async function uploadFileWithProgress(
  file: File,
  onProgress?: ProgressCallback,
  abortSignal?: AbortSignal,
  maxRetries = 3,
  expectedContentSha256Hex?: string
): Promise<IpfsUploadResponse> {
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      return await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const formData = new FormData();
        formData.append('file', file);

        xhr.open('POST', `${API_BASE_URL}/api/ipfs/upload`);

        // Handle progress
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && onProgress) {
            onProgress({
              loaded: event.loaded,
              total: event.total,
              percentage: Math.round((event.loaded / event.total) * 100),
            });
          }
        };

        // Handle completion
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const response = JSON.parse(xhr.responseText);
              if (
                expectedContentSha256Hex &&
                response.contentSha256Hex?.toLowerCase() !== expectedContentSha256Hex.toLowerCase()
              ) {
                reject(new Error('Uploaded content hash mismatch'));
                return;
              }

              resolve(response);
            } catch {
              reject(new Error('Failed to parse upload response'));
            }
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        };

        // Handle errors
        xhr.onerror = () => reject(new Error('Network error during upload'));

        // Handle cancellation
        if (abortSignal) {
          abortSignal.addEventListener('abort', () => {
            xhr.abort();
            reject(new Error('Upload aborted'));
          });
        }

        xhr.send(formData);
      });
    } catch (error) {
      attempt++;
      if (attempt >= maxRetries || (error instanceof Error && error.message === 'Upload aborted')) {
        throw error;
      }
      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }

  throw new Error('Upload failed after maximum retries');
}
