export interface IpfsUploadResult {
  cid: string;
  url: string;
  fileSizeBytes: number;
  mimeType: string;
}

export interface IpfsUploadInput {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  contentHash: string;
}

export interface IpfsProvider {
  readonly name: string;
  upload(input: IpfsUploadInput): Promise<IpfsUploadResult>;
}

export interface IpfsValidationConfig {
  maxFileSizeBytes: number;
  allowedMimeTypes: string[];
}

export interface EvidenceMetadataRecord {
  cid: string;
  url: string;
  fileSizeBytes: number;
  mimeType: string;
  contentHash: string;
  provider: string;
}
