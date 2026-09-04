import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';

/**
 * BE-SPEC §8: TypeORM's migration generator is never the source of truth -
 * migrations are hand-written SQL (src/database/migrations/). This DataSource
 * exists for (a) the app's own connection pool, wired into Nest via
 * database.module.ts, using the app role (DATABASE_URL, no BYPASSRLS), and
 * (b) the occasional `typeorm schema:log` diff-reading workflow §8 allows.
 * No entities: nothing here is TypeORM-managed schema.
 */
export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [],
  synchronize: false,
  logging: false,
};

export const AppDataSource = new DataSource(dataSourceOptions);
