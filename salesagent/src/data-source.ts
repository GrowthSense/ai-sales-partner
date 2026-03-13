import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
dotenv.config();

// Used by TypeORM CLI for migration:generate and migration:run
// Run after `npm run build` — CLI uses compiled dist/data-source.js
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  entities: [__dirname + '/**/*.entity.{ts,js}'],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
});
