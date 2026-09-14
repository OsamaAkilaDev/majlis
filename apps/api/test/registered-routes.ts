import type { INestApplication, Type } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../src/auth/public.decorator';
import { API_PREFIX } from '../src/config/api-prefix';

export interface RegisteredRoute {
  /** A supertest agent method, e.g. 'get': matches `request(server)[method](path)`. */
  method: 'get' | 'post' | 'put' | 'delete' | 'patch' | 'options' | 'head';
  path: string;
  isPublic: boolean;
}

function joinPath(...segments: (string | undefined)[]): string {
  const parts = segments
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .map((s) => s.replace(/^\/+|\/+$/g, ''))
    .filter((s) => s.length > 0);
  return `/${parts.join('/')}`;
}

/**
 * Enumerates every controller route Nest actually registered, reading the
 * same metadata RouterExplorer does, rather than a hand-maintained path
 * list, so a route added in a later stage that forgets @Public() (or
 * forgets to think about auth at all) turns the guard test red without
 * anyone remembering to update it.
 *
 * SwaggerModule.setup mounts its docs UI directly on the underlying HTTP
 * adapter, outside Nest's controller/module metadata entirely, so it never
 * appears here: nothing to special-case.
 */
export function registeredRoutes(app: INestApplication): RegisteredRoute[] {
  const modulesContainer = app.get(ModulesContainer);
  const reflector = app.get(Reflector);
  const routes: RegisteredRoute[] = [];

  for (const module of modulesContainer.values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as Type | undefined;
      if (!controller) continue;

      const controllerPath = Reflect.getMetadata(PATH_METADATA, controller) as string | undefined;
      const controllerPublic = reflector.get<boolean>(IS_PUBLIC_KEY, controller) ?? false;

      for (const key of Object.getOwnPropertyNames(controller.prototype)) {
        // `constructor` is the class itself (the same function PATH_METADATA
        // was set on via @Controller()), so it must be excluded explicitly,
        // not just filtered by "has PATH_METADATA": it always does.
        if (key === 'constructor') continue;
        const handler = (controller.prototype as Record<string, unknown>)[key];
        if (typeof handler !== 'function') continue;

        const handlerPath = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        if (handlerPath === undefined) continue; // not a route handler

        const methodEnum = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod;
        const methodName = RequestMethod[methodEnum]?.toLowerCase();
        const handlerPublic = reflector.get<boolean>(IS_PUBLIC_KEY, handler) ?? false;

        routes.push({
          method: methodName as RegisteredRoute['method'],
          path: joinPath(API_PREFIX, controllerPath, handlerPath),
          isPublic: controllerPublic || handlerPublic,
        });
      }
    }
  }

  return routes;
}
