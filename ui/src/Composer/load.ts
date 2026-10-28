// One cache for every deferred Composer consumer. This file stays JSX-free so
// route and URL helpers can import the preloader in plain Node tests.
import type { ComponentType } from "react";
import type { ComposerProps } from "./index.tsx";

export type ComposerComponent = ComponentType<ComposerProps>;

export interface RetryableLoader<T> {
  get(): T | null;
  load(): Promise<T>;
  install(value: T): void;
}

export function createRetryableLoader<T>(importer: () => Promise<T>): RetryableLoader<T> {
  let loaded: T | null = null;
  let pending: Promise<T> | null = null;
  return {
    get: () => loaded,
    load: () => {
      if (loaded) return Promise.resolve(loaded);
      pending ??= importer().then(
        (value) => {
          loaded = value;
          return value;
        },
        (error: unknown) => {
          pending = null;
          throw error;
        },
      );
      return pending;
    },
    install: (value) => { loaded = value; },
  };
}

const composer = createRetryableLoader<ComposerComponent>(() => import("./index.tsx").then((m) => m.Composer));

export function loadedComposer(): ComposerComponent | null {
  return composer.get();
}

export function loadComposer(): Promise<ComposerComponent> {
  return composer.load();
}

export function installComposer(component: ComposerComponent): void {
  composer.install(component);
}
