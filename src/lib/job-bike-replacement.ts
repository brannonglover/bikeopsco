/**
 * Replacing a job's bike list (PATCH /api/jobs/[id] with `bikes`) must keep
 * each bike's identity. A job bike carries its done / waiting-on-parts state,
 * services and products, part notes, and — once work is done — the repair
 * history recorded on the customer's bike. Deleting and recreating it on an
 * ordinary edit (changing the bike type, adding a photo) silently threw all of
 * that away.
 *
 * So each incoming bike is matched to an existing one and updated in place.
 * Only existing bikes nobody matched are removed — and the route refuses that
 * when one of them has recorded repair history.
 */

export type ExistingJobBike = {
  id: string;
  bikeId: string | null;
  make: string;
  sortOrder: number;
};

export type IncomingJobBike = {
  /** The job bike being edited; sent by current clients. */
  id?: string | null;
  bikeId?: string | null;
  make: string;
};

export type ReplacementPlan = {
  /** For each incoming bike (same order), the existing job bike it updates, or null to create. */
  matches: Array<string | null>;
  /** Existing job bikes no incoming bike matched. */
  removedIds: string[];
};

function sameMake(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Match incoming bikes to existing job bikes: by job-bike id, then by customer
 * bike, then — for clients that send neither — by position when the make is
 * the same. Each existing bike is matched at most once. Pure.
 */
export function planJobBikeReplacement(
  existing: ExistingJobBike[],
  incoming: IncomingJobBike[]
): ReplacementPlan {
  const ordered = [...existing].sort((a, b) => a.sortOrder - b.sortOrder);
  const byId = new Map(ordered.map((b) => [b.id, b]));
  const claimed = new Set<string>();
  const matches: Array<string | null> = incoming.map(() => null);

  // 1. Explicit job-bike id.
  incoming.forEach((b, i) => {
    if (b.id && byId.has(b.id) && !claimed.has(b.id)) {
      matches[i] = b.id;
      claimed.add(b.id);
    }
  });
  // 2. Same customer bike.
  incoming.forEach((b, i) => {
    if (matches[i] || !b.bikeId) return;
    const hit = ordered.find((e) => !claimed.has(e.id) && e.bikeId === b.bikeId);
    if (hit) {
      matches[i] = hit.id;
      claimed.add(hit.id);
    }
  });
  // 3. Same position and make (older clients send no ids).
  incoming.forEach((b, i) => {
    if (matches[i]) return;
    const hit = ordered[i];
    if (hit && !claimed.has(hit.id) && sameMake(hit.make, b.make)) {
      matches[i] = hit.id;
      claimed.add(hit.id);
    }
  });

  return { matches, removedIds: ordered.filter((e) => !claimed.has(e.id)).map((e) => e.id) };
}

/**
 * An operation would destroy or orphan repair history recorded on a
 * customer's bike. Routes answer 409 with `message`, which says what to do.
 */
export class RepairHistoryConflictError extends Error {
  constructor(
    message: string,
    readonly recordCount: number
  ) {
    super(message);
    this.name = "RepairHistoryConflictError";
  }
}
