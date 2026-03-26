export interface ClaimFormData {
  policyId: string;
  amount: string;
  narrative: string;
  evidenceFiles: File[];
}

export interface IpfsUploadResponse {
  cid: string;
  gatewayUrls: string[];
  filename: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
}

export type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

export interface FileUploadProgress {
  file: File;
  progress: number;
  status: UploadStatus;
  error?: string;
  response?: IpfsUploadResponse;
}
