import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ENTITIES } from './entities';
import { MIGRATIONS } from './migrations';

try {
  process.loadEnvFile();
} catch {
  void 0;
}

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: ENTITIES,
  migrations: MIGRATIONS,
});
