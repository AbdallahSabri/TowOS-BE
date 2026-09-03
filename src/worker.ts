import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module.js';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
}

bootstrap().catch((err: unknown) => {
  console.error('Fatal error during worker bootstrap:', err instanceof Error ? err.message : err);
  process.exit(1);
});
