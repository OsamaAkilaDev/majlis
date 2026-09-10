// Runs before any test file is imported — which matters, because
// @nestjs/config captures and validates the environment at import time.
// Assigning these inside a beforeAll hook would be too late and the API
// under test would quietly connect to the development database.
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is not set. Copy .env.example to .env.');
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DIRECT_URL = process.env.TEST_DATABASE_URL;
