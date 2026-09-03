import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  await app.listen(process.env.PORT ?? 3000);
}

bootstrap().catch((err: unknown) => {
  // Logger (pino) may not exist yet if bootstrap failed before app.get(Logger)
  // (e.g. config validation), so this is a deliberate console fallback.
  console.error('Fatal error during bootstrap:', err instanceof Error ? err.message : err);
  process.exit(1);
});
