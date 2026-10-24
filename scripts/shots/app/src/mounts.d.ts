import type { ComponentType } from "react";

export interface MountModule {
  default: ComponentType;
  /** Optional heading for the mount page. */
  title?: string;
}

export function mountIds(): string[];
export function loadMount(id: string): MountModule;
