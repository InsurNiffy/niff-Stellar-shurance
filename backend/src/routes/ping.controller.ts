import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('system')
@Controller('ping')
export class PingController {
  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiResponse({ status: 200, description: 'Service is alive' })
  ping(): { status: string } {
    return { status: 'ok' };
  }
}
