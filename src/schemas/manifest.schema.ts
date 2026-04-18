import { z } from 'zod';

export const fileStrategySchema = z.enum(['copy', 'symlink']);

export const trackedFileSchema = z.object({
  source: z.string(),
  destination: z.string(),
  category: z.string(),
  strategy: fileStrategySchema,
  encrypted: z.boolean().default(false),
  template: z.boolean().default(false),
  permissions: z.string().optional(),
  added: z.string(),
  modified: z.string(),
  checksum: z.string(),
  /**
   * Named host-groups this file belongs to (e.g. "kubuntu", "kali").
   * Post-migration invariant: groups.length >= 1. A file with no groups
   * applies nowhere; commands enforce this after migration completes.
   * Accepts undefined/missing on parse for backward compat with pre-2.0
   * manifests — the migration flow is what populates it.
   */
  groups: z.array(z.string()).default([]),
});

export const tuckManifestSchema = z.object({
  version: z.string(),
  created: z.string(),
  updated: z.string(),
  machine: z.string().optional(),
  files: z.record(trackedFileSchema),
});

export type TrackedFileInput = z.input<typeof trackedFileSchema>;
export type TrackedFileOutput = z.output<typeof trackedFileSchema>;
export type TuckManifestInput = z.input<typeof tuckManifestSchema>;
export type TuckManifestOutput = z.output<typeof tuckManifestSchema>;

/**
 * Manifest format version.
 * 2.0.0 — adds host groups (TrackedFile.groups, >=1 required post-migration).
 *         Old 1.x manifests load with empty groups and trip MigrationRequiredError.
 */
export const CURRENT_MANIFEST_VERSION = '2.0.0';

export const createEmptyManifest = (machine?: string): TuckManifestOutput => {
  const now = new Date().toISOString();
  return {
    version: CURRENT_MANIFEST_VERSION,
    created: now,
    updated: now,
    machine,
    files: {},
  };
};
