import React, { useCallback, useRef, useState } from 'react';

export interface EvidenceFile {
  id: string;
  name: string;
  size: number;
  type: string;
  progress: number;
  status: 'pending' | 'uploading' | 'uploaded' | 'error';
  hash?: string;
  ipfsUrl?: string;
  error?: string;
}

export interface EvidenceUploaderProps {
  files: EvidenceFile[];
  onChange: (files: EvidenceFile[]) => void;
  minFiles?: number;
  maxFiles?: number;
  maxSizeBytes?: number;
  acceptedTypes?: string[];
  uploadFile?: (file: File, onProgress: (pct: number) => void) => Promise<{ hash: string; ipfsUrl: string }>;
}

const DEFAULT_MAX_SIZE = 25 * 1024 * 1024;
const DEFAULT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

function makeId(): string {
  return `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validateFile(
  file: File,
  acceptedTypes: string[],
  maxSizeBytes: number,
): string | null {
  if (!acceptedTypes.includes(file.type)) {
    return `Unsupported type. Allowed: ${acceptedTypes.join(', ')}`;
  }
  if (file.size > maxSizeBytes) {
    return `File exceeds ${formatBytes(maxSizeBytes)} limit`;
  }
  return null;
}

export const EvidenceUploader: React.FC<EvidenceUploaderProps> = ({
  files,
  onChange,
  minFiles = 1,
  maxFiles = 10,
  maxSizeBytes = DEFAULT_MAX_SIZE,
  acceptedTypes = DEFAULT_TYPES,
  uploadFile,
}) => {
  const [dragActive, setDragActive] = useState(false);
  const [rejections, setRejections] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const rawFiles = useRef<Map<string, File>>(new Map());

  const updateFile = useCallback(
    (id: string, patch: Partial<EvidenceFile>) => {
      onChange(files.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    },
    [files, onChange],
  );

  const runUpload = useCallback(
    async (entry: EvidenceFile, raw: File) => {
      if (!uploadFile) {
        updateFile(entry.id, { status: 'uploaded', progress: 100 });
        return;
      }
      updateFile(entry.id, { status: 'uploading', progress: 0, error: undefined });
      try {
        const result = await uploadFile(raw, (pct) =>
          updateFile(entry.id, { progress: Math.min(100, Math.round(pct)) }),
        );
        updateFile(entry.id, {
          status: 'uploaded',
          progress: 100,
          hash: result.hash,
          ipfsUrl: result.ipfsUrl,
        });
      } catch (err) {
        updateFile(entry.id, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Upload failed',
        });
      }
    },
    [updateFile, uploadFile],
  );

  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      const list = Array.from(incoming);
      const errors: string[] = [];
      const accepted: EvidenceFile[] = [];
      let remaining = maxFiles - files.length;

      for (const file of list) {
        if (remaining <= 0) {
          errors.push(`Maximum of ${maxFiles} evidence files reached`);
          break;
        }
        const problem = validateFile(file, acceptedTypes, maxSizeBytes);
        if (problem) {
          errors.push(`${file.name}: ${problem}`);
          continue;
        }
        const id = makeId();
        rawFiles.current.set(id, file);
        accepted.push({
          id,
          name: file.name,
          size: file.size,
          type: file.type,
          progress: 0,
          status: 'pending',
        });
        remaining -= 1;
      }

      setRejections(errors);
      if (accepted.length > 0) {
        onChange([...files, ...accepted]);
        accepted.forEach((entry) => {
          const raw = rawFiles.current.get(entry.id);
          if (raw) void runUpload(entry, raw);
        });
      }
    },
    [files, maxFiles, acceptedTypes, maxSizeBytes, onChange, runUpload],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragActive(false);
      if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const handleRetry = useCallback(
    (entry: EvidenceFile) => {
      const raw = rawFiles.current.get(entry.id);
      if (raw) void runUpload(entry, raw);
    },
    [runUpload],
  );

  const handleRemove = useCallback(
    (id: string) => {
      rawFiles.current.delete(id);
      onChange(files.filter((f) => f.id !== id));
    },
    [files, onChange],
  );

  const countOk = files.length >= minFiles && files.length <= maxFiles;

  return (
    <div className="evidence-uploader">
      <div
        className={`evidence-dropzone${dragActive ? ' evidence-dropzone--active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
      >
        <p>Drag &amp; drop evidence here, or click to browse</p>
        <p className="evidence-hint">
          {acceptedTypes.join(', ')} · up to {formatBytes(maxSizeBytes)} each · {minFiles}–{maxFiles} files
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={acceptedTypes.join(',')}
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      <p className="evidence-warning" role="note">
        Images are stripped of location metadata before upload. Evidence is stored publicly on IPFS and
        will be visible to anyone.
      </p>

      {rejections.length > 0 && (
        <ul className="evidence-rejections" role="alert">
          {rejections.map((msg, i) => (
            <li key={i}>{msg}</li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <ul className="evidence-list">
          {files.map((file) => (
            <li key={file.id} className={`evidence-item evidence-item--${file.status}`}>
              <div className="evidence-item__meta">
                <span className="evidence-item__name">{file.name}</span>
                <span className="evidence-item__size">{formatBytes(file.size)}</span>
              </div>
              {file.status === 'uploading' && (
                <div className="evidence-progress" role="progressbar" aria-valuenow={file.progress} aria-valuemin={0} aria-valuemax={100}>
                  <div className="evidence-progress__bar" style={{ width: `${file.progress}%` }} />
                  <span className="evidence-progress__label">{file.progress}%</span>
                </div>
              )}
              {file.status === 'uploaded' && file.hash && (
                <div className="evidence-item__hash">
                  <code>{file.hash}</code>
                  {file.ipfsUrl && (
                    <a href={file.ipfsUrl} target="_blank" rel="noreferrer noopener">
                      View on IPFS
                    </a>
                  )}
                </div>
              )}
              {file.status === 'error' && (
                <div className="evidence-item__error">
                  <span>{file.error ?? 'Upload failed'}</span>
                  <button type="button" onClick={() => handleRetry(file)}>
                    Retry
                  </button>
                </div>
              )}
              <button
                type="button"
                className="evidence-item__remove"
                onClick={() => handleRemove(file.id)}
                aria-label={`Remove ${file.name}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className={`evidence-count${countOk ? '' : ' evidence-count--invalid'}`}>
        {files.length} of {maxFiles} files attached
        {!countOk && ` — at least ${minFiles} required`}
      </p>
    </div>
  );
};

export default EvidenceUploader;
