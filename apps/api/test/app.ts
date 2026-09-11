import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';

/**
 * Boots the real AppModule through the real configureApp, exactly as
 * main.ts does — so the guards, pipes and filters under test in every
 * integration suite are the real ones, not a stand-in.
 *
 * `extraModules` adds test-only fixtures (e.g. `ProtectedTestModule`, see
 * test/fixtures/) alongside the real AppModule. They ride the same global
 * guards and filters AppModule wires up — they are never added to AppModule
 * itself.
 */
export async function createTestApp(extraModules: Type[] = []): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, ...extraModules],
  }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}
