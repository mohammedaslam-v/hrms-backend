/**
 * The reporting tree, in one place.
 *
 * Two pages need it — leave approvals ("whose requests land in my queue") and
 * My page ("whose profile may I open") — and they must agree. A second copy of
 * this SQL is how one screen ends up with a safety guard the other one lacks.
 *
 * A reporting line is user-entered data, so it can contain a cycle: someone set
 * as their own manager, or A → B → A. Either would make the recursion run
 * without end and hang the connection while holding metadata locks. Two guards
 * prevent that, and both must stay:
 *
 *   · the root is excluded from their own tree, so a self-reference cannot even
 *     seed the walk — and, on the approvals side, nobody approves their own leave
 *   · depth is capped, so any remaining loop terminates
 */

/** Deepest reporting chain we will walk. Also the backstop against a cycle. */
export const MAX_REPORTING_DEPTH = 10;

/**
 * A `WITH RECURSIVE tree AS (…)` clause yielding every employee below `rootId`.
 *
 * Takes three bind parameters, all the root id:
 * `[rootId, rootId, rootId]` — seed manager, seed self-exclusion, recursive
 * self-exclusion. Callers append their own parameters after these.
 */
export const REPORTING_TREE_CTE = `WITH RECURSIVE tree AS (
         SELECT id, 1 AS depth
           FROM hrms_employees
          WHERE manager_id = ? AND id <> ?
         UNION ALL
         SELECT e.id, t.depth + 1
           FROM hrms_employees e
           JOIN tree t ON e.manager_id = t.id
          WHERE t.depth < ${MAX_REPORTING_DEPTH} AND e.id <> ?
       )`;

/** The bind parameters `REPORTING_TREE_CTE` expects, in order. */
export const reportingTreeParams = (rootId: number): number[] => [rootId, rootId, rootId];
