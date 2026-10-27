import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * RFC 7807 Problem Details for HTTP APIs.
 *
 * Emitted by HttpExceptionFilter for every error response. `type` is a URI
 * reference into the error catalog (`/api/v1/errors#<CODE>`), or `about:blank`
 * when no catalog code applies.
 */
export class ProblemDetailDto {
  @ApiProperty({ example: '/api/v1/errors#CLAIM_NOT_FOUND' })
  type!: string;

  @ApiProperty({ example: 'Not Found' })
  title!: string;

  @ApiProperty({ example: 404 })
  status!: number;

  @ApiProperty({ example: 'Claim does not exist.' })
  detail!: string;

  @ApiProperty({ example: '/api/v1/claims/42' })
  instance!: string;

  @ApiPropertyOptional({
    description: 'Catalog code, i18nKey, requestId and error-specific details.',
    example: { code: 'CLAIM_NOT_FOUND', i18nKey: 'errors.claims.notFound' },
  })
  extensions?: Record<string, unknown>;
}
