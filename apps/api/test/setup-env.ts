import { testDatabaseUrl } from './db';

// Runs before any test file is imported, because @nestjs/config captures and
// validates the environment at import time. Assigning these in a beforeAll hook
// is too late, and the API would connect to the development database.
const url = testDatabaseUrl();

process.env.DATABASE_URL = url;
process.env.DIRECT_URL = url;
