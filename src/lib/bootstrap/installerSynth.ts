import type { PackageSpec, ToolDefinition } from '../../schemas/bootstrap.schema.js';

/**
 * Expand the `installer` + `packages` shorthand into the same
 * `install`/`check`/`update` shell scripts a hand-written `[[tool]]` block
 * would have. Lets users maintain a single array of formula/package names
 * instead of editing three lockstep shell snippets when adding or removing
 * a tool.
 *
 * Tools that don't set `installer` pass through unchanged. Tools that do
 * have their `install`/`check`/`update` fields populated (overwriting any
 * user-provided values is a schema error caught earlier — see the
 * `superRefine` in `bootstrap.schema.ts`).
 *
 * The synthesized scripts are deliberately verbose and explicit (full brew
 * paths, per-binary `test -x` loops, `dpkg -s` probes) so they behave the
 * same way the prior hand-written blocks did. See `runner.ts` for execution
 * semantics.
 *
 * Linux-only paths today (`/home/linuxbrew/.linuxbrew/bin/...`); macOS hosts
 * would need a separate prefix detection if/when this expands. See the
 * design discussion in the 05.02.2026 session.
 */

const LINUXBREW_BIN = '/home/linuxbrew/.linuxbrew/bin';
const LINUXBREW_BREW = `${LINUXBREW_BIN}/brew`;

/**
 * Normalise a `PackageSpec` into `{ name, bin }`. Strings are sugar for
 * `{ name: <s>, bin: <s> }`; the object form may omit `bin` (defaults to
 * `name`) or supply it when formula≠binary (brew `neovim`→`nvim`, etc.).
 */
const normalizePackage = (spec: PackageSpec): { name: string; bin: string } => {
  if (typeof spec === 'string') {
    return { name: spec, bin: spec };
  }
  return { name: spec.name, bin: spec.bin ?? spec.name };
};

const synthesizeBrew = (
  packages: PackageSpec[],
  postInstall: string | undefined,
  postUpdate: string | undefined
): { install: string; check: string; update: string } => {
  const normalized = packages.map(normalizePackage);
  const names = normalized.map((p) => p.name).join(' ');
  const bins = normalized.map((p) => p.bin).join(' ');

  const check = `for bin in ${bins}; do
  test -x "${LINUXBREW_BIN}/$bin" || exit 1
done`;

  const installLines = [
    'set -e',
    `BREW=${LINUXBREW_BREW}`,
    `"$BREW" install ${names}`,
  ];
  if (postInstall && postInstall.trim().length > 0) {
    installLines.push(postInstall.trimEnd());
  }
  const install = installLines.join('\n');

  const updateLines = [
    'set -e',
    `BREW=${LINUXBREW_BREW}`,
    '"$BREW" update',
    `"$BREW" upgrade ${names} || true`,
  ];
  if (postUpdate && postUpdate.trim().length > 0) {
    updateLines.push(postUpdate.trimEnd());
  }
  const update = updateLines.join('\n');

  return { install, check, update };
};

const synthesizeApt = (
  packages: PackageSpec[],
  postInstall: string | undefined,
  postUpdate: string | undefined
): { install: string; check: string; update: string } => {
  const names = packages.map(normalizePackage).map((p) => p.name).join(' ');

  const check = `for pkg in ${names}; do
  dpkg -s "$pkg" >/dev/null 2>&1 || exit 1
done`;

  const installLines = ['set -e', `sudo apt-get install -y ${names}`];
  if (postInstall && postInstall.trim().length > 0) {
    installLines.push(postInstall.trimEnd());
  }
  const install = installLines.join('\n');

  const updateLines = [`sudo apt-get install -y --only-upgrade ${names}`];
  if (postUpdate && postUpdate.trim().length > 0) {
    updateLines.push(postUpdate.trimEnd());
  }
  const update = updateLines.join('\n');

  return { install, check, update };
};

/**
 * Walk a parsed tool definition and, if it uses the `installer` shorthand,
 * populate `install`/`check`/`update` from `packages`. Tools without
 * `installer` are returned with their raw scripts intact (and `install`
 * narrowed to a required string — schema validation already guaranteed
 * one mode or the other was set).
 *
 * Returns a new object; does not mutate the input.
 */
export const synthesizeTool = (
  tool: Omit<ToolDefinition, 'install'> & { install?: string }
): ToolDefinition => {
  if (tool.installer === undefined) {
    if (tool.install === undefined) {
      throw new Error(
        `synthesizeTool: tool "${tool.id}" has neither installer nor install — schema validation should have caught this`
      );
    }
    return { ...tool, install: tool.install };
  }

  if (!tool.packages || tool.packages.length === 0) {
    throw new Error(
      `synthesizeTool: tool "${tool.id}" has installer="${tool.installer}" but no packages — schema validation should have caught this`
    );
  }

  const synthesized =
    tool.installer === 'brew'
      ? synthesizeBrew(tool.packages, tool.postInstall, tool.postUpdate)
      : synthesizeApt(tool.packages, tool.postInstall, tool.postUpdate);

  return {
    ...tool,
    install: synthesized.install,
    check: synthesized.check,
    update: synthesized.update,
  };
};
