import { testDatabaseUrl } from './db';

// Runs before any test file is imported — which matters, because
// @nestjs/config captures and validates the environment at import time.
// Assigning these inside a beforeAll hook would be too late and the API
// under test would quietly connect to the development database.
const url = testDatabaseUrl();

process.env.DATABASE_URL = url;
process.env.DIRECT_URL = url;
