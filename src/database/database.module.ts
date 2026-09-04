import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { EnvironmentVariables } from '../common/config/environment-variables.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        type: 'postgres' as const,
        url: config.get('DATABASE_URL', { infer: true }),
        entities: [],
        synchronize: false,
        logging: false,
      }),
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
