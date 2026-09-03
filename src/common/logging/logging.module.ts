import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { buildPinoOptions } from './pino-options.js';
import type { EnvironmentVariables } from '../config/environment-variables.js';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        buildPinoOptions(config.get('LOG_LEVEL', { infer: true })),
    }),
  ],
})
export class LoggingModule {}
