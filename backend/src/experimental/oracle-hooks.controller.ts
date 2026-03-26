import { Body, Controller, Post } from '@nestjs/common';
import { Feature } from '../feature-flags/feature.decorator';

@Controller('experimental/oracle-hooks')
@Feature('experimental.oracleHooks')
export class OracleHooksController {
  @Post('ingest')
  ingest(@Body() body: Record<string, unknown>) {
    return {
      accepted: true,
      receivedKeys: Object.keys(body || {}),
    };
  }
}
