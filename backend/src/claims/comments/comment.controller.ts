import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { WalletAddress } from '../../auth/decorators/wallet-address.decorator';
import { AuthIdentityService } from '../../auth/auth-identity.service';
import { CommentService } from './comment.service';
import { CreateCommentDto, CommentResponseDto } from './comment.dto';

@ApiTags('claims')
@Controller('claims/:id/comments')
export class CommentController {
  constructor(
    private readonly commentService: CommentService,
    private readonly authIdentity: AuthIdentityService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List active comments for a claim' })
  @ApiResponse({ status: 200, type: [CommentResponseDto] })
  list(@Param('id', ParseIntPipe) claimId: number): Promise<CommentResponseDto[]> {
    return this.commentService.list(claimId);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a comment to a claim' })
  @ApiResponse({ status: 201, type: CommentResponseDto })
  create(
    @Param('id', ParseIntPipe) claimId: number,
    @Body() dto: CreateCommentDto,
    @WalletAddress() walletAddress: string,
  ): Promise<CommentResponseDto> {
    return this.commentService.create(claimId, walletAddress, dto.body);
  }

  @Delete(':commentId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a comment (author or admin)' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  async remove(
    @Param('id', ParseIntPipe) _claimId: number,
    @Param('commentId') commentId: string,
    @WalletAddress() walletAddress: string,
    @Req() req: Request,
  ): Promise<void> {
    const identity = await this.authIdentity.resolveRequestIdentity(req);
    const isAdmin = identity?.kind === 'staff' && identity.role === 'admin';
    const deletedBy = isAdmin ? walletAddress : undefined;
    await this.commentService.softDelete(commentId, walletAddress, isAdmin, deletedBy);
  }
}
