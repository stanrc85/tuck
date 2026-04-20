import { BootstrapError } from '../../errors.js';

/**
 * Minimum shape the resolver needs from a tool definition. Kept narrow so
 * merged catalogs (user `bootstrap.toml` + built-in registry, landing in a
 * later session) can be fed straight through without a shaping step.
 */
export interface ResolvableTool {
  id: string;
  requires: string[];
}

/**
 * Topologically sort tools so that every tool appears after every tool it
 * requires. Returns IDs in install order.
 *
 * DFS with three-color state tracking:
 *   - WHITE: unvisited
 *   - GRAY:  on the current recursion stack (revisit = cycle)
 *   - BLACK: fully processed
 *
 * Chosen over Kahn's (indegree-based) algorithm because DFS gives us the
 * participating nodes of a cycle for free via the recursion stack — the
 * ticket specifically asks for a helpful cycle error, not just "cycle
 * detected somewhere."
 *
 * Deterministic: tools are visited in input-array order, so two tools with
 * no `requires` between them preserve their input-relative order in the
 * output. This matters because built-in registry merging (TASK-022) will
 * produce a predictable combined order.
 *
 * @throws BootstrapError on unknown `requires` target or cycle.
 */
export const resolveInstallOrder = (tools: ResolvableTool[]): string[] => {
  const byId = new Map<string, ResolvableTool>();
  for (const tool of tools) {
    byId.set(tool.id, tool);
  }

  // Check unknown requires up front with a scoped error message, rather
  // than letting it surface as an undefined lookup mid-DFS.
  for (const tool of tools) {
    for (const req of tool.requires) {
      if (!byId.has(req)) {
        throw new BootstrapError(
          `Tool "${tool.id}" requires unknown tool "${req}"`,
          [
            `Define a tool with id = "${req}"`,
            `Or remove "${req}" from ${tool.id}'s requires list`,
          ]
        );
      }
    }
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const state = new Map<string, number>();
  for (const tool of tools) {
    state.set(tool.id, WHITE);
  }

  const order: string[] = [];
  const stack: string[] = [];

  const visit = (id: string): void => {
    const color = state.get(id);
    if (color === BLACK) {
      return;
    }
    if (color === GRAY) {
      const cycleStart = stack.indexOf(id);
      const cycle = [...stack.slice(cycleStart), id];
      throw new BootstrapError(
        `Dependency cycle: ${cycle.join(' -> ')}`,
        ['Remove one of the `requires` edges on the cycle path']
      );
    }
    state.set(id, GRAY);
    stack.push(id);
    const tool = byId.get(id);
    if (tool) {
      for (const req of tool.requires) {
        visit(req);
      }
    }
    stack.pop();
    state.set(id, BLACK);
    order.push(id);
  };

  for (const tool of tools) {
    if (state.get(tool.id) === WHITE) {
      visit(tool.id);
    }
  }

  return order;
};
