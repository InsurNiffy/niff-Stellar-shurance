import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCommentDto {
  @ApiProperty({ description: 'Comment body', minLength: 1, maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;

  @ApiProperty({ required: false, description: 'Id of the comment being replied to' })
  @IsOptional()
  @IsString()
  parentId?: string;
}

export class ModerateCommentDto {
  @ApiProperty({ required: false, minLength: 1, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body?: string;

  @ApiProperty({ required: false, description: 'true hides the comment, false unhides it' })
  @IsOptional()
  @IsBoolean()
  hidden?: boolean;
}

export class CommentListResponseDto {
  @ApiProperty({ type: () => [CommentResponseDto] }) data!: CommentResponseDto[];
  @ApiProperty({ nullable: true, type: String }) next_cursor!: string | null;
}

export class CommentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() claimId!: number;
  @ApiProperty() authorAddress!: string;
  @ApiProperty() body!: string;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ required: false, nullable: true }) parentId?: string | null;
}
