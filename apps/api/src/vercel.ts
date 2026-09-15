import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';

/**
 * The serverless entry point. `main.ts` stays the entry point for a
 * long-running process (the dev loop, the integration suite, any host that
 * runs a real server); this one exists only for Vercel, which invokes a
 * handler rather than owning a port.
 *
 * Both call `configureApp`, which is the whole reason that function exists.
 * A hand-rolled second bootstrap is how three of them drifted apart before.
 *
 * NOTE for whoever edits this: `vercel.json` points the build at the
 * COMPILED `dist/vercel.js`, never at this file. Vercel's function builder
 * is esbuild-based, and esbuild does not implement `emitDecoratorMetadata`,
 * so bundling the TypeScript directly produces a server whose constructor
 * injection is silently broken. That is the same trap CLAUDE.md records for
 * `tsx`. `tsc` emits the metadata; esbuild then only has to bundle JS that
 * already carries it.
 */
type NodeHandler = (req: IncomingMessage, res: ServerResponse) => void;

let cached: Promise<NodeHandler> | undefined;

async function create(): Promise<NodeHandler> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  configureApp(app);

  // init(), not listen(): the platform owns the socket. Everything else
  // configureApp does (global prefix, pipes, filters, OpenAPI) is identical.
  await app.init();

  // Nest's own Express instance, rather than one built here from an
  // imported `express`. `express` is only a transitive dependency of
  // @nestjs/platform-express, and pnpm's isolated node_modules does not
  // resolve it from this package: importing it directly compiles and then
  // throws MODULE_NOT_FOUND at cold start.
  return app.getHttpAdapter().getInstance() as NodeHandler;
}

/**
 * Cached across warm invocations, so only a cold start pays for building the
 * Nest container. The promise itself is cached rather than the resolved
 * value: two concurrent requests arriving on a cold instance would otherwise
 * each start their own bootstrap.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  cached ??= create();
  (await cached)(req, res);
}
