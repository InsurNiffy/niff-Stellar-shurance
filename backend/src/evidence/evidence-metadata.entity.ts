import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('evidence_metadata')
export class EvidenceMetadata {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 128, unique: true })
  cid: string;

  @Column({ type: 'text' })
  url: string;

  @Column({ name: 'file_size_bytes', type: 'bigint' })
  fileSizeBytes: number;

  @Column({ name: 'mime_type', type: 'varchar', length: 255 })
  mimeType: string;

  @Column({ name: 'content_hash', type: 'varchar', length: 128 })
  contentHash: string;

  @Column({ name: 'provider', type: 'varchar', length: 64 })
  provider: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
