import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ENTITIES } from './entities';
import { MIGRATIONS } from './migrations';

// The TypeORM command line (`npm run migration:*`) runs outside Nest, so it does not get ConfigModule's
// .env loading. Node can load it itself; a missing file is fine (variables may come from the environment).
try {
  process.loadEnvFile();
} catch {
  /* no .env file: rely on real environment variables */
}

/** Used ONLY by the TypeORM CLI. The running app builds its connection in DatabaseModule. */
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: ENTITIES,
  migrations: MIGRATIONS,
});
