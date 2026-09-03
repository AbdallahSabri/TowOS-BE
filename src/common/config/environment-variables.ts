import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUrl, Max, Min, MinLength } from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

export enum LogLevel {
  Fatal = 'fatal',
  Error = 'error',
  Warn = 'warn',
  Info = 'info',
  Debug = 'debug',
  Trace = 'trace',
  Silent = 'silent',
}

/**
 * BE-SPEC §11: the app fails to start on a missing or malformed variable.
 * No defaults for anything security-relevant — SESSION_TTL_HOURS is the only
 * variable with a default (12), matching the spec's `SESSION_TTL_HOURS=12`.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV!: NodeEnv;

  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT!: number;

  @IsUrl(
    { protocols: ['postgres', 'postgresql'], require_tld: false, require_protocol: true },
    { message: 'DATABASE_URL must be a postgres:// connection string' },
  )
  DATABASE_URL!: string;

  @IsUrl(
    { protocols: ['postgres', 'postgresql'], require_tld: false, require_protocol: true },
    { message: 'DATABASE_MIGRATION_URL must be a postgres:// connection string' },
  )
  DATABASE_MIGRATION_URL!: string;

  @IsUrl(
    { protocols: ['redis', 'rediss'], require_tld: false, require_protocol: true },
    { message: 'REDIS_URL must be a redis:// connection string' },
  )
  REDIS_URL!: string;

  @IsUrl(
    { protocols: ['amqp', 'amqps'], require_tld: false, require_protocol: true },
    { message: 'RABBITMQ_URL must be an amqp:// connection string' },
  )
  RABBITMQ_URL!: string;

  @MinLength(32, { message: 'SESSION_SECRET must be at least 32 characters' })
  SESSION_SECRET!: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === undefined ? 12 : Number(value)))
  @IsInt()
  @Min(1)
  SESSION_TTL_HOURS: number = 12;

  @IsEnum(LogLevel)
  LOG_LEVEL!: LogLevel;
}
