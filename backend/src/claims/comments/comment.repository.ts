import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CommentRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActive(claimId: number, after?: string, take = 20) {
    return this.prisma.claimComment.findMany({
      where: { claimId, deletedAt: null, hiddenAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: take + 1,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    });
  }

  moderate(id: string, data: { body?: string; hidden?: boolean }) {
    return this.prisma.claimComment.update({
      where: { id },
      data: {
        ...(data.body !== undefined ? { body: data.body, editedAt: new Date() } : {}),
        ...(data.hidden !== undefined ? { hiddenAt: data.hidden ? new Date() : null } : {}),
      },
    });
  }

  findAll(claimId: number) {
    return this.prisma.claimComment.findMany({
      where: { claimId },
      orderBy: { createdAt: 'asc' },
    });
  }

  create(claimId: number, authorAddress: string, body: string, parentId?: string) {
    return this.prisma.claimComment.create({
      data: { claimId, authorAddress, body, parentId: parentId ?? null },
    });
  }

  findById(id: string) {
    return this.prisma.claimComment.findUnique({ where: { id } });
  }

  softDelete(id: string, deletedBy?: string) {
    return this.prisma.claimComment.update({
      where: { id },
      data: { deletedAt: new Date(), deletedBy: deletedBy ?? null },
    });
  }
}
