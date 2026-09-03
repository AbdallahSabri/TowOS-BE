import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';

async function bootstrap() {
  await NestFactory.createApplicationContext(WorkerModule);
}

await bootstrap();
