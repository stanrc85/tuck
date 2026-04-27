import { Command } from 'commander';
import { prompts, colors as c, formatCount } from '../ui/index.js';
import { collapsePath } from '../lib/paths.js';
import {
  listSnapshots,
  getSnapshot,
  getLatestSnapshot,
  restoreSnapshot,
  restoreFileFromSnapshot,
  deleteSnapshot,
  getSnapshotsSize,
  formatSnapshotSize,
  formatSnapshotDate,
  formatSnapshotKind,
  Snapshot,
} from '../lib/timemachine.js';

export interface UndoOptions {
  list?: boolean;
  latest?: boolean;
  file?: string;
  delete?: string;
  force?: boolean;
  dryRun?: boolean;
}

/**
 * Display a list of available snapshots inside a clack frame.
 */
const showSnapshotList = async (): Promise<void> => {
  prompts.intro('tuck undo --list');

  const snapshots = await listSnapshots();

  if (snapshots.length === 0) {
    prompts.log.message(
      c.dim(
        'Snapshots are created automatically before apply, restore, sync, remove --delete, and clean.',
      ),
    );
    prompts.outro('No backup snapshots found');
    return;
  }

  for (const snapshot of snapshots) {
    const date = formatSnapshotDate(snapshot.id);
    const fileCount = snapshot.files.filter((f) => f.existed).length;
    const kindLabel = formatSnapshotKind(snapshot.kind);

    const lines = [
      `${c.cyan(snapshot.id)}  ${c.dim(`[${kindLabel}]`)}`,
      c.dim(`  Date:    ${date}`),
      c.dim(`  Reason:  ${snapshot.reason}`),
      c.dim(`  Files:   ${formatCount(fileCount, 'file')} backed up`),
      c.dim(`  Machine: ${snapshot.machine}`),
    ];
    prompts.log.message(lines.join('\n'));
  }

  const totalSize = await getSnapshotsSize();
  prompts.log.message(
    c.dim(
      [
        `Total backup size: ${formatSnapshotSize(totalSize)}`,
        '',
        'Restore a snapshot:  tuck undo <snapshot-id>',
        'Restore the latest:  tuck undo --latest',
      ].join('\n'),
    ),
  );

  prompts.outro(`${formatCount(snapshots.length, 'snapshot')} available`);
};

/**
 * Format snapshot details as a single dim block. Caller assumes a frame is open.
 */
const renderSnapshotDetails = (snapshot: Snapshot): string => {
  const headerLines = [
    c.bold('Snapshot Details:'),
    c.dim(`  ID:      ${snapshot.id}`),
    c.dim(`  Kind:    ${formatSnapshotKind(snapshot.kind)}`),
    c.dim(`  Date:    ${formatSnapshotDate(snapshot.id)}`),
    c.dim(`  Reason:  ${snapshot.reason}`),
    c.dim(`  Machine: ${snapshot.machine}`),
    '',
    c.bold('Files in snapshot:'),
  ];

  const fileLines = snapshot.files.map((file) =>
    file.existed
      ? c.dim(`  ok ${collapsePath(file.originalPath)}`)
      : c.dim(`  - ${collapsePath(file.originalPath)} (did not exist)`),
  );

  return [...headerLines, ...fileLines].join('\n');
};

/**
 * Restore from a specific snapshot inside a clack frame.
 */
const restoreFromSnapshot = async (snapshotId: string, options: UndoOptions): Promise<void> => {
  prompts.intro('tuck undo');

  const snapshot = await getSnapshot(snapshotId);

  if (!snapshot) {
    prompts.log.error(`Snapshot not found: ${snapshotId}`);
    const snapshots = await listSnapshots();
    if (snapshots.length > 0) {
      const lines = ['Available snapshots:'];
      for (const s of snapshots.slice(0, 5)) {
        lines.push(`  ${s.id} - ${formatSnapshotDate(s.id)}`);
      }
      if (snapshots.length > 5) {
        lines.push(`  ... and ${snapshots.length - 5} more`);
      }
      prompts.log.message(c.dim(lines.join('\n')));
    }
    prompts.outro('Restore aborted');
    return;
  }

  prompts.log.message(renderSnapshotDetails(snapshot));

  if (!options.force && !options.dryRun) {
    const backedUpCount = snapshot.files.filter((f) => f.existed).length;
    const confirmed = await prompts.confirm(
      `Restore ${formatCount(backedUpCount, 'file')} from this snapshot?`,
      true,
    );

    if (!confirmed) {
      prompts.outro('Restore cancelled');
      return;
    }
  }

  if (options.dryRun) {
    const lines = [c.bold('Dry run — would restore:')];
    for (const file of snapshot.files) {
      if (file.existed) {
        lines.push(`  ${c.warning('~')} ${collapsePath(file.originalPath)}`);
      } else {
        lines.push(`  ${c.error('-')} ${collapsePath(file.originalPath)} (would remove)`);
      }
    }
    prompts.log.message(lines.join('\n'));
    prompts.outro('Dry run — re-run without --dry-run to apply');
    return;
  }

  const spinner = prompts.spinner();
  spinner.start('Restoring files...');
  const restoredFiles = await restoreSnapshot(snapshotId);
  spinner.stop(`Restored ${formatCount(restoredFiles.length, 'file')}`);

  if (restoredFiles.length > 0) {
    prompts.log.message(
      c.dim(restoredFiles.map((file) => `  ok ${collapsePath(file)}`).join('\n')),
    );
  }

  prompts.outro(`Restored ${formatCount(restoredFiles.length, 'file')}`);
};

/**
 * Restore a single file from a snapshot inside a clack frame.
 */
const restoreSingleFile = async (
  snapshotId: string,
  filePath: string,
  options: UndoOptions,
): Promise<void> => {
  prompts.intro('tuck undo');

  const snapshot = await getSnapshot(snapshotId);

  if (!snapshot) {
    prompts.log.error(`Snapshot not found: ${snapshotId}`);
    prompts.outro('Restore aborted');
    return;
  }

  if (options.dryRun) {
    prompts.log.message(c.dim(`Would restore ${filePath} from snapshot ${snapshotId}`));
    prompts.outro('Dry run — re-run without --dry-run to apply');
    return;
  }

  await restoreFileFromSnapshot(snapshotId, filePath);
  prompts.outro(`Restored ${filePath}`);
};

/**
 * Delete a snapshot inside a clack frame.
 */
const removeSnapshot = async (snapshotId: string, options: UndoOptions): Promise<void> => {
  prompts.intro('tuck undo --delete');

  const snapshot = await getSnapshot(snapshotId);

  if (!snapshot) {
    prompts.log.error(`Snapshot not found: ${snapshotId}`);
    prompts.outro('Deletion aborted');
    return;
  }

  if (!options.force) {
    prompts.log.message(renderSnapshotDetails(snapshot));
    const confirmed = await prompts.confirm('Delete this snapshot permanently?', false);

    if (!confirmed) {
      prompts.outro('Deletion cancelled');
      return;
    }
  }

  await deleteSnapshot(snapshotId);
  prompts.outro(`Deleted snapshot ${snapshotId}`);
};

/**
 * Interactive snapshot picker.
 */
const runInteractiveUndo = async (): Promise<void> => {
  prompts.intro('tuck undo');

  const snapshots = await listSnapshots();

  if (snapshots.length === 0) {
    prompts.log.message(
      c.dim(
        'Snapshots are created before apply, restore, sync, remove --delete, and clean.',
      ),
    );
    prompts.outro('No backup snapshots available');
    return;
  }

  const snapshotOptions = snapshots.map((s) => {
    const fileCount = s.files.filter((f) => f.existed).length;
    const date = formatSnapshotDate(s.id);
    const kindLabel = formatSnapshotKind(s.kind);
    const reasonSnippet =
      s.reason.length > 40 ? `${s.reason.slice(0, 40)}...` : s.reason;
    return {
      value: s.id,
      label: `[${kindLabel}] ${date} — ${reasonSnippet}`,
      hint: `${fileCount} file${fileCount === 1 ? '' : 's'}`,
    };
  });

  const selectedId = await prompts.select('Select a snapshot to restore:', snapshotOptions);

  const snapshot = await getSnapshot(selectedId);
  if (!snapshot) {
    prompts.log.error('Snapshot not found');
    prompts.outro('Restore aborted');
    return;
  }

  const previewLines: string[] = ['Files in this snapshot:'];
  for (const file of snapshot.files.slice(0, 10)) {
    if (file.existed) {
      previewLines.push(`  ${collapsePath(file.originalPath)}`);
    }
  }
  if (snapshot.files.length > 10) {
    previewLines.push(`  ... and ${snapshot.files.length - 10} more`);
  }
  prompts.log.message(c.dim(previewLines.join('\n')));

  const confirmed = await prompts.confirm('Restore these files?', true);

  if (!confirmed) {
    prompts.cancel('Restore cancelled');
    return;
  }

  const spinner = prompts.spinner();
  spinner.start('Restoring files...');
  const restoredFiles = await restoreSnapshot(selectedId);
  spinner.stop(`Restored ${formatCount(restoredFiles.length, 'file')}`);

  prompts.outro(`Restored ${formatCount(restoredFiles.length, 'file')}`);
};

const runUndo = async (snapshotId: string | undefined, options: UndoOptions): Promise<void> => {
  if (options.list) {
    await showSnapshotList();
    return;
  }

  if (options.delete) {
    await removeSnapshot(options.delete, options);
    return;
  }

  if (options.latest) {
    const latest = await getLatestSnapshot();
    if (!latest) {
      prompts.intro('tuck undo --latest');
      prompts.outro('No backup snapshots available');
      return;
    }
    await restoreFromSnapshot(latest.id, options);
    return;
  }

  if (snapshotId) {
    if (options.file) {
      await restoreSingleFile(snapshotId, options.file, options);
    } else {
      await restoreFromSnapshot(snapshotId, options);
    }
    return;
  }

  await runInteractiveUndo();
};

export const undoCommand = new Command('undo')
  .description('Restore files from a Time Machine backup snapshot')
  .argument('[snapshot-id]', 'Snapshot ID to restore (format: YYYY-MM-DD-HHMMSS)')
  .option('-l, --list', 'List all available backup snapshots')
  .option('--latest', 'Restore the most recent snapshot')
  .option('--file <path>', 'Restore a single file from the snapshot')
  .option('--delete <id>', 'Delete a specific snapshot')
  .option('-f, --force', 'Skip confirmation prompts')
  .option('--dry-run', 'Show what would be restored without making changes')
  .action(async (snapshotId: string | undefined, options: UndoOptions) => {
    await runUndo(snapshotId, options);
  });
