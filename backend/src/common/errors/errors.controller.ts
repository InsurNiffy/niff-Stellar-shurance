import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { ERROR_CATALOG } from './error-catalog';

@ApiTags('errors')
@Controller({ path: 'errors', version: '1' })
export class ErrorsController {
  @Get()
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'Returns the full error catalog for client-side message rendering' })
  getCatalog() {
    return { data: ERROR_CATALOG };
  }
}
