import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CommentRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActive(claimId: number) {
    return this.prisma.claimComment.findMany({
      where: { claimId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  findAll(claimId: number) {
    return this.prisma.claimComment.findMany({
      where: { claimId },
      orderBy: { createdAt: 'asc' },
    });
  }

  create(claimId: number, authorAddress: string, body: string) {
    return this.prisma.claimComment.create({
      data: { claimId, authorAddress, body },
    });
  }

  findById(id: string) {
    return this.prisma.claimComment.findUnique({ where: { id } });
  }

  softDelete(id: string) {
    return this.prisma.claimComment.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
