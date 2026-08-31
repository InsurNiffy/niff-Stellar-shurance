import { Controller, Post, RawBodyRequest, Req, BadRequestException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Feature } from '../feature-flags/feature.decorator';
import { xdr } from '@stellar/stellar-sdk';

interface XdrDecodeResponse {
  type: string;
  value: Record<string, unknown>;
}

@ApiTags('dev')
@Controller('dev/xdr')
@Feature('ENABLE_DEV_TOOLS')
export class XdrDecodeController {
  @Post('decode')
  @ApiOperation({
    summary: 'Decode XDR binary to JSON (dev-only)',
    description:
      'Decodes a Stellar XDR binary blob to its JSON representation. ' +
      'Useful for debugging and development. ' +
      'Gated behind ENABLE_DEV_TOOLS feature flag.',
  })
  decodeXdr(@Req() req: RawBodyRequest<Buffer>): XdrDecodeResponse {
    const buffer = req.rawBody;

    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('Request body must contain raw XDR binary data');
    }

    const base64 = buffer.toString('base64');

    try {
      // Try to decode as a TransactionEnvelope first (most common)
      try {
        const txEnvelope = xdr.TransactionEnvelope.fromXDR(base64, 'base64');
        return {
          type: 'TransactionEnvelope',
          value: this.xdrToJson(txEnvelope),
        };
      } catch {
        // Fall back to ScVal (Soroban contract values)
        const scVal = xdr.ScVal.fromXDR(base64, 'base64');
        return {
          type: 'ScVal',
          value: this.xdrToJson(scVal),
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(`Failed to decode XDR: ${msg}`);
    }
  }

  /**
   * Convert XDR objects to JSON-serializable format.
   * This is a simple converter that stringifies the object representation.
   */
  private xdrToJson(xdrObj: unknown): Record<string, unknown> {
    // XDR objects have methods like toXDR() and their structure is already somewhat JSON-like
    // Convert to a serializable format
    if (xdrObj === null || xdrObj === undefined) {
      return {};
    }

    if (typeof xdrObj !== 'object') {
      return { value: xdrObj };
    }

    // For XDR objects, attempt to extract the underlying data
    const obj = xdrObj as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const key in obj) {
      const value = obj[key];
      if (typeof value === 'function') {
        continue;
      }
      if (typeof value === 'object' && value !== null && 'toXDR' in value) {
        // Nested XDR object - convert it recursively
        result[key] = this.xdrToJson(value);
      } else {
        // Primitive or serializable value
        try {
          result[key] = JSON.parse(JSON.stringify(value));
        } catch {
          result[key] = String(value);
        }
      }
    }

    return result;
  }
}
