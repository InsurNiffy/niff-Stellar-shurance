import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { AppModule } from '../backend/src/app.module';

/**
 * Exports the live NestJS OpenAPI document to `backend/openapi.json`.
 *
 * The spec is generated from the actual controllers/DTO decorators so that
 * the committed artifact can be diffed in CI and consumed by
 * `openapi-typescript` to produce typed frontend clients.
 */
async function exportSpec(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });

  try {
    const config = new DocumentBuilder()
      .setTitle('Handsoff API')
      .setDescription('OpenAPI specification generated from NestJS decorators')
      .setVersion('1.0')
      .build();

    const document: OpenAPIObject = SwaggerModule.createDocument(app, config);

    const outputPath = join(__dirname, '..', 'backend', 'openapi.json');
    writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

    // eslint-disable-next-line no-console
    console.log(`OpenAPI spec written to ${outputPath}`);
  } finally {
    await app.close();
  }
}

exportSpec().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Failed to export OpenAPI spec:', error);
  process.exitCode = 1;
});
