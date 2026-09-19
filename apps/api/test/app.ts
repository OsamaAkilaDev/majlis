import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';

/** Boots the real AppModule through the real configureApp, as main.ts does, so
 * every suite tests the real guards, pipes and filters. `extraModules` adds
 * test-only fixtures alongside it, riding the same global guards, never added to
 * AppModule itself. `overrides` swaps a provider for a test double before the
 * module compiles. */
export async function createTestApp(
  extraModules: Type[] = [],
  overrides: { provide: unknown; useValue: unknown }[] = [],
): Promise<INestApplication> {
  const builder = Test.createTestingModule({
    imports: [AppModule, ...extraModules],
  });
  for (const { provide, useValue } of overrides) {
    builder.overrideProvider(provide).useValue(useValue);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}
