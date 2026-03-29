'use client';

import { X, Upload, FileText, AlertTriangle, CheckCircle2 } from 'lucide-react';
import React, { useState, useCallback } from 'react';

import { Button, Progress, Label } from '@/components/ui';
import { uploadFileWithProgress, UploadProgress } from '@/lib/ipfs-upload';

interface FileUploadState {
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  url?: string;
  error?: string;
  controller?: AbortController;
}

export type EvidenceAttachment = { url: string; contentSha256Hex: string };

interface EvidenceStepProps {
  evidence: EvidenceAttachment[];
  onChange: (items: EvidenceAttachment[]) => void;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function EvidenceStep({ evidence, onChange }: EvidenceStepProps) {
  const [uploads, setUploads] = useState<Record<string, FileUploadState>>({});
  const [consent, setConsent] = useState(false);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newUploads = { ...uploads };

    files.forEach((file) => {
      // Validation
      if (file.size > MAX_FILE_SIZE) {
        alert(`File ${file.name} is too large. Max size is 5MB.`);
        return;
      }
      if (!ALLOWED_TYPES.includes(file.type)) {
        alert(`File ${file.name} has unsupported type. Use JPEG, PNG or WebP.`);
        return;
      }

      const id = `${file.name}-${Date.now()}`;
      newUploads[id] = {
        file,
        progress: 0,
        status: 'pending',
      };
    });

    setUploads(newUploads);
  }, [uploads]);

  const startUpload = async (id: string) => {
    const upload = uploads[id];
    if (!upload || upload.status === 'uploading') return;

    const controller = new AbortController();
    setUploads(prev => ({
      ...prev,
      [id]: { ...prev[id], status: 'uploading', progress: 0, controller }
    }));

    try {
      const response = await uploadFileWithProgress(
        upload.file,
        (p: UploadProgress) => {
          setUploads(prev => ({
            ...prev,
            [id]: { ...prev[id], progress: p.percentage }
          }));
        },
        controller.signal
      );

      const url = response.gatewayUrls[0] || '';
      const contentSha256Hex = response.contentSha256Hex;
      setUploads(prev => ({
        ...prev,
        [id]: { ...prev[id], status: 'completed', progress: 100, url }
      }));

      onChange([...evidence, { url, contentSha256Hex }]);
    } catch (err) {
      if (err instanceof Error && err.message === 'Upload aborted') return;
      
      setUploads(prev => ({
        ...prev,
        [id]: { ...prev[id], status: 'error', error: err instanceof Error ? err.message : 'Upload failed' }
      }));
    }
  };

  const cancelUpload = (id: string) => {
    const upload = uploads[id];
    if (upload.controller) {
      upload.controller.abort();
    }
    const newUploads = { ...uploads };
    delete newUploads[id];
    setUploads(newUploads);

    if (upload.url) {
      onChange(evidence.filter((e) => e.url !== upload.url));
    }
  };

  return (
    <div className="space-y-6 py-4">
      <div className="space-y-4">
        <div className="rounded-lg border-2 border-dashed border-muted-foreground/25 p-8 text-center">
          <Upload className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-semibold">Evidence Collection</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Upload photos or documents as evidence for your claim. Max 5MB per file.
          </p>
          <div className="mt-6">
            <input
              type="file"
              id="file-upload"
              multiple
              accept="image/*"
              className="hidden"
              onChange={handleFileSelect}
            />
            <Button asChild variant="outline">
              <label htmlFor="file-upload" className="cursor-pointer">
                Select Files
              </label>
            </Button>
          </div>
        </div>

        {/* Upload List */}
        <div className="space-y-3">
          {Object.entries(uploads).map(([id, upload]) => (
            <div key={id} className="flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 overflow-hidden">
                  <FileText className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm font-medium">{upload.file.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  {upload.status === 'pending' && (
                    <Button size="sm" onClick={() => startUpload(id)}>Upload</Button>
                  )}
                  {upload.status === 'completed' && (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  )}
                  {upload.status === 'error' && (
                    <span className="text-xs text-destructive">{upload.error}</span>
                  )}
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => cancelUpload(id)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {upload.status === 'uploading' && (
                <div className="space-y-1">
                  <Progress value={upload.progress} className="h-1.5" />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>Uploading...</span>
                    <span>{upload.progress}%</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4 rounded-lg border bg-yellow-50 p-4 dark:bg-yellow-900/10">
        <div className="flex gap-3">
          <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-500" />
          <div className="space-y-2">
            <h4 className="text-sm font-bold text-yellow-900 dark:text-yellow-200">Legal & Privacy Reminder</h4>
            <ul className="list-disc pl-4 text-xs text-yellow-800 space-y-1 dark:text-yellow-300">
              <li>Evidence uploaded via IPFS is **permanently immutable**. It cannot be deleted.</li>
              <li>Please **redact** any PII (Personally Identifiable Information) that is not relevant to the claim.</li>
              <li>Ensure you have the right to share these images.</li>
            </ul>
            <div className="flex items-center space-x-2 pt-2">
              <input
                type="checkbox"
                id="consent"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <Label htmlFor="consent" className="text-xs font-medium cursor-pointer">
                I understand that this evidence will be stored permanently on IPFS.
              </Label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
