/**
 * Auto-update checker for tuck CLI.
 *
 * Disabled on this fork: the npm `@prnv/tuck` package is owned by upstream.
 * Checking it from a fork install would prompt users to "update" to upstream
 * versions, which are effectively downgrades compared to this fork's 2.x.
 * A GitHub-releases based checker could replace this later if wanted.
 */
export const checkForUpdates = async (): Promise<void> => {
  return;
};
