'use client';

import { useCallback, useRef, useState } from 'react';

export interface EvidenceFile {
  name: string;
  size: number;
  type: string;
  cid: string;
  hash: string;
}

interface EvidenceStepProps {
  files: EvidenceFile[];
  onChange: (files: EvidenceFile[]) => void;
  apiBaseUrl?: string;
}

interface UploadResponse {
  cid?: string;
  hash?: string;
  IpfsHash?: string;
}

async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export default function EvidenceStep({
  files,
  onChange,
  apiBaseUrl = '',
}: EvidenceStepProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = useCallback(
    async (selected: FileList | null) => {
      if (!selected || selected.length === 0) return;
      setError(null);
      setUploading(true);
      try {
        const uploaded: EvidenceFile[] = [];
        for (const file of Array.from(selected)) {
          const hash = await sha256Hex(file);
          const body = new FormData();
          body.append('file', file);
          const res = await fetch(`${apiBaseUrl}/ipfs/upload`, {
            method: 'POST',
            body,
          });
          if (!res.ok) {
            throw new Error(`Upload failed (${res.status})`);
          }
          const data: UploadResponse = await res.json();
          const cid = data.cid ?? data.IpfsHash;
          if (!cid) {
            throw new Error('Upload response missing CID');
          }
          uploaded.push({
            name: file.name,
            size: file.size,
            type: file.type,
            cid,
            hash: data.hash ?? hash,
          });
        }
        onChange([...files, ...uploaded]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [apiBaseUrl, files, onChange],
  );

  const removeFile = (cid: string) => {
    onChange(files.filter((f) => f.cid !== cid));
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Evidence</h2>
        <p className="text-sm text-gray-500">
          Upload supporting documents. Files are stored on IPFS and their
          hashes are recorded on-chain.
        </p>
      </div>

      <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center">
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {uploading ? 'Uploading…' : 'Select files'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {files.length > 0 && (
        <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200">
          {files.map((file) => (
            <li key={file.cid} className="flex items-start justify-between gap-4 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="truncate text-xs text-gray-500">CID: {file.cid}</p>
                <p className="truncate text-xs text-gray-500">Hash: {file.hash}</p>
              </div>
              <button
                type="button"
                onClick={() => removeFile(file.cid)}
                className="text-sm text-red-600 hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
