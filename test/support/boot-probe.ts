import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module.js';

/**
 * Exercises the exact same module graph as src/main.ts (AppModule, including
 * TenantModule's BYPASSRLS assertion) without calling app.listen() - a
 * successfully booted HTTP server never exits on its own, which would hang
 * a spawning test until timeout. Only used by
 * test/bypass-rls.integration-spec.ts.
 */
async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  await app.close();
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
