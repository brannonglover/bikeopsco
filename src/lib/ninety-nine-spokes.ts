const API_BASE = "https://api.99spokes.com";

const SPEC_INCLUDE =
  "components,wheels,gearing,shifting,suspension,tireClearance,thumbnailUrl";

export type NinetyNineSpokesComponent = {
  label: string;
  value: string;
  detail?: string;
};

export type NinetyNineSpokesSpecGroup = {
  id: string;
  title: string;
  items: NinetyNineSpokesComponent[];
};

export type NinetyNineSpokesMatchedBike = {
  id: string;
  maker: string;
  model: string;
  family: string;
  year: number;
  category: string;
  subcategory: string | null;
  url: string;
  thumbnailUrl?: string;
};

export type NinetyNineSpokesSpecsPayload = {
  matched: NinetyNineSpokesMatchedBike;
  groups: NinetyNineSpokesSpecGroup[];
};

type ApiComponent = {
  description?: string;
  display?: string;
  maker?: string;
  model?: string;
  standard?: string;
  shellWidthMM?: number;
  threaded?: boolean;
  kind?: string;
  material?: string;
  innerWidthMM?: number;
  width?: string;
  hangerStandard?: string;
};

type ApiBike = {
  id: string;
  url: string;
  thumbnailUrl?: string;
  maker: string;
  model: string;
  family: string;
  year: number;
  category: string;
  subcategory?: string | null;
  shifting?: { kind?: string };
  wheels?: { configuration?: string; kinds?: string[] };
  tireClearance?: { wheelKind?: string; maxTireWidth?: string }[];
  gearing?: {
    kinds?: string[];
    front?: { count?: number };
    rear?: { count?: number };
  };
  suspension?: {
    configuration?: string;
    front?: { travelMM?: number; isRigid?: boolean };
    rear?: { travelMM?: number; isRigid?: boolean };
  };
  components?: Record<string, ApiComponent | undefined>;
};

type SearchResponse = {
  total: number;
  items: ApiBike[];
  nextCursor?: string | null;
};

export function isNinetyNineSpokesConfigured(): boolean {
  return Boolean(getNinetyNineSpokesApiKey());
}

export function getNinetyNineSpokesApiKey(): string | null {
  return process.env.NINETY_NINE_SPOKES_API_KEY?.trim() || null;
}

function authHeaders(): HeadersInit {
  const key = getNinetyNineSpokesApiKey();
  if (!key) throw new Error("99 Spokes API is not configured");
  return {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  };
}

async function parseApiError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
  return data?.message ?? data?.error ?? `99 Spokes API error (${res.status})`;
}

function formatComponent(c: ApiComponent | undefined): string | null {
  if (!c) return null;
  if (c.display?.trim()) return c.display.trim();
  const parts = [c.maker, c.model].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  if (c.description?.trim()) return c.description.trim();
  return null;
}

function pushComponent(
  items: NinetyNineSpokesComponent[],
  label: string,
  component: ApiComponent | undefined,
  extra?: string
) {
  const value = formatComponent(component);
  if (!value && !extra) return;
  items.push({
    label,
    value: value ?? extra ?? "—",
    detail: component?.description?.trim() || undefined,
  });
}

export function buildSpecGroups(bike: ApiBike): NinetyNineSpokesSpecGroup[] {
  const groups: NinetyNineSpokesSpecGroup[] = [];
  const c = bike.components ?? {};

  const drivetrain: NinetyNineSpokesComponent[] = [];
  if (bike.shifting?.kind) {
    drivetrain.push({ label: "Shifting", value: bike.shifting.kind });
  }
  if (bike.gearing?.kinds?.length) {
    drivetrain.push({ label: "Gearing type", value: bike.gearing.kinds.join(", ") });
  }
  if (bike.gearing?.front?.count != null || bike.gearing?.rear?.count != null) {
    const front = bike.gearing.front?.count;
    const rear = bike.gearing.rear?.count;
    const parts: string[] = [];
    if (front != null) parts.push(`${front} front`);
    if (rear != null) parts.push(`${rear} rear`);
    drivetrain.push({ label: "Chainrings / cogs", value: parts.join(" · ") });
  }
  pushComponent(drivetrain, "Shifters", c.shifters);
  pushComponent(drivetrain, "Rear derailleur", c.rearDerailleur);
  pushComponent(drivetrain, "Front derailleur", c.frontDerailleur);
  pushComponent(drivetrain, "Crankset", c.crank);
  pushComponent(drivetrain, "Cassette", c.cassette);
  pushComponent(drivetrain, "Chain", c.chain);
  const bb = c.bottomBracket;
  if (bb) {
    const parts = [formatComponent(bb), bb.standard].filter(Boolean) as string[];
    if (bb.shellWidthMM != null) parts.push(`${bb.shellWidthMM}mm shell`);
    if (bb.threaded != null) parts.push(bb.threaded ? "threaded" : "press-fit");
    if (parts.length > 0) {
      drivetrain.push({
        label: "Bottom bracket",
        value: parts.join(" · "),
        detail: bb.description?.trim() || undefined,
      });
    }
  }
  if (drivetrain.length > 0) {
    groups.push({ id: "drivetrain", title: "Drivetrain", items: drivetrain });
  }

  const wheels: NinetyNineSpokesComponent[] = [];
  if (bike.wheels?.kinds?.length) {
    wheels.push({
      label: "Wheel size",
      value: bike.wheels.kinds.map((k) => `${k}"`).join(", "),
      detail: bike.wheels.configuration ? `Configuration: ${bike.wheels.configuration}` : undefined,
    });
  }
  pushComponent(wheels, "Rims", c.rims);
  pushComponent(wheels, "Tires", c.tires);
  pushComponent(wheels, "Front hub", c.frontHub);
  pushComponent(wheels, "Rear hub", c.rearHub);
  pushComponent(wheels, "Spokes", c.spokes);
  if (bike.tireClearance?.length) {
    wheels.push({
      label: "Max tire width",
      value: bike.tireClearance
        .map((t) => (t.wheelKind ? `${t.wheelKind}": ${t.maxTireWidth}` : t.maxTireWidth))
        .filter(Boolean)
        .join(" · "),
    });
  }
  if (wheels.length > 0) {
    groups.push({ id: "wheels", title: "Wheels & tires", items: wheels });
  }

  const brakes: NinetyNineSpokesComponent[] = [];
  pushComponent(brakes, "Brakes", c.brakes);
  pushComponent(brakes, "Brake levers", c.brakeLevers);
  pushComponent(brakes, "Disc rotors", c.discRotors);
  if (brakes.length > 0) {
    groups.push({ id: "brakes", title: "Brakes", items: brakes });
  }

  const frame: NinetyNineSpokesComponent[] = [];
  if (c.frame?.material) {
    frame.push({ label: "Frame material", value: c.frame.material });
  }
  if (c.frame?.hangerStandard) {
    frame.push({ label: "Derailleur hanger", value: c.frame.hangerStandard.toUpperCase() });
  }
  pushComponent(frame, "Frame", c.frame);
  pushComponent(frame, "Fork", c.fork);
  pushComponent(frame, "Headset", c.headset);
  pushComponent(frame, "Rear shock", c.rearShock);
  if (bike.suspension?.configuration) {
    frame.push({ label: "Suspension", value: bike.suspension.configuration });
  }
  if (bike.suspension?.front?.travelMM != null) {
    frame.push({ label: "Front travel", value: `${bike.suspension.front.travelMM} mm` });
  }
  if (bike.suspension?.rear?.travelMM != null) {
    frame.push({ label: "Rear travel", value: `${bike.suspension.rear.travelMM} mm` });
  }
  if (frame.length > 0) {
    groups.push({ id: "frame", title: "Frame & suspension", items: frame });
  }

  const cockpit: NinetyNineSpokesComponent[] = [];
  pushComponent(cockpit, "Stem", c.stem);
  pushComponent(cockpit, "Handlebar", c.handlebar);
  pushComponent(cockpit, "Grips", c.grips);
  pushComponent(cockpit, "Saddle", c.saddle);
  pushComponent(cockpit, "Seatpost", c.seatpost);
  if (cockpit.length > 0) {
    groups.push({ id: "cockpit", title: "Cockpit & contact points", items: cockpit });
  }

  return groups;
}

export function toMatchedBike(bike: ApiBike): NinetyNineSpokesMatchedBike {
  return {
    id: bike.id,
    maker: bike.maker,
    model: bike.model,
    family: bike.family,
    year: bike.year,
    category: bike.category,
    subcategory: bike.subcategory ?? null,
    url: bike.url,
    thumbnailUrl: bike.thumbnailUrl,
  };
}

export function toSpecsPayload(bike: ApiBike): NinetyNineSpokesSpecsPayload {
  return {
    matched: toMatchedBike(bike),
    groups: buildSpecGroups(bike),
  };
}

function scoreBikeMatch(bike: ApiBike, make: string, model: string | null): number {
  const makeLower = make.trim().toLowerCase();
  const modelLower = (model?.trim() ?? "").toLowerCase();
  let score = 0;

  const makerLower = bike.maker.trim().toLowerCase();
  if (makerLower === makeLower) score += 50;
  else if (makerLower.includes(makeLower) || makeLower.includes(makerLower)) score += 20;

  const bikeModel = bike.model.trim().toLowerCase();
  const bikeFamily = bike.family.trim().toLowerCase();
  const searchTarget = `${bikeModel} ${bikeFamily}`.trim();

  if (modelLower) {
    if (bikeModel === modelLower) score += 40;
    else if (bikeModel.includes(modelLower) || modelLower.includes(bikeModel)) score += 28;
    else if (searchTarget.includes(modelLower) || modelLower.includes(searchTarget)) score += 18;
    else {
      const modelTokens = modelLower.split(/\s+/).filter((t) => t.length > 2);
      const matchedTokens = modelTokens.filter(
        (t) => bikeModel.includes(t) || bikeFamily.includes(t) || modelLower.includes(t)
      );
      score += Math.min(20, matchedTokens.length * 6);
    }
  } else {
    score += 10;
  }

  return score;
}

const MATCH_SCORE_THRESHOLD = 45;

export async function searchBikes(query: string, limit = 10): Promise<ApiBike[]> {
  const params = new URLSearchParams({
    q: query,
    queryMode: "match",
    limit: String(limit),
    include: SPEC_INCLUDE,
  });
  const res = await fetch(`${API_BASE}/v1/bikes?${params}`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await parseApiError(res));
  const data = (await res.json()) as SearchResponse;
  return data.items ?? [];
}

export async function getBikeById(id: string): Promise<ApiBike> {
  const params = new URLSearchParams({ include: SPEC_INCLUDE });
  const res = await fetch(`${API_BASE}/v1/bikes/${encodeURIComponent(id)}?${params}`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await parseApiError(res));
  return (await res.json()) as ApiBike;
}

export type MatchResult =
  | { ok: true; bike: ApiBike; score: number }
  | { ok: false; reason: "no_results" | "low_confidence"; candidates?: ApiBike[] };

export async function matchBikeForJobBike(make: string, model: string | null): Promise<MatchResult> {
  const trimmedMake = make.trim();
  if (!trimmedMake) return { ok: false, reason: "no_results" };

  const query = [trimmedMake, model?.trim()].filter(Boolean).join(" ");
  const results = await searchBikes(query, 10);
  if (results.length === 0) {
    const fallback = await searchBikes(trimmedMake, 10).catch(() => [] as ApiBike[]);
    if (fallback.length === 0) return { ok: false, reason: "no_results" };
    const scoredFallback = fallback
      .map((bike) => ({ bike, score: scoreBikeMatch(bike, trimmedMake, model) }))
      .sort((a, b) => b.score - a.score);
    const bestFallback = scoredFallback[0];
    if (!bestFallback || bestFallback.score < MATCH_SCORE_THRESHOLD) {
      return {
        ok: false,
        reason: "low_confidence",
        candidates: scoredFallback.slice(0, 5).map((s) => s.bike),
      };
    }
    return { ok: true, bike: bestFallback.bike, score: bestFallback.score };
  }

  const scored = results
    .map((bike) => ({ bike, score: scoreBikeMatch(bike, trimmedMake, model) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < MATCH_SCORE_THRESHOLD) {
    return {
      ok: false,
      reason: "low_confidence",
      candidates: scored.slice(0, 5).map((s) => s.bike),
    };
  }
  return { ok: true, bike: best.bike, score: best.score };
}

export async function fetchSpecsForJobBike(
  make: string,
  model: string | null,
  existingSpokesId?: string | null
): Promise<
  | { ok: true; spokesId: string; specs: NinetyNineSpokesSpecsPayload }
  | { ok: false; reason: "not_configured" | "no_match" | "low_confidence"; candidates?: NinetyNineSpokesMatchedBike[]; message?: string }
> {
  if (!isNinetyNineSpokesConfigured()) {
    return { ok: false, reason: "not_configured", message: "99 Spokes API key is not configured" };
  }

  try {
    if (existingSpokesId) {
      const bike = await getBikeById(existingSpokesId);
      return { ok: true, spokesId: bike.id, specs: toSpecsPayload(bike) };
    }

    const match = await matchBikeForJobBike(make, model);
    if (!match.ok) {
      return {
        ok: false,
        reason: match.reason === "no_results" ? "no_match" : "low_confidence",
        candidates: match.candidates?.map(toMatchedBike),
        message:
          match.reason === "no_results"
            ? "No matching bike found in 99 Spokes"
            : "Could not confidently match this bike — try refining make and model",
      };
    }

    let bike = match.bike;
    if (!bike.components) {
      bike = await getBikeById(bike.id);
    }
    return { ok: true, spokesId: bike.id, specs: toSpecsPayload(bike) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch bike specs";
    return { ok: false, reason: "no_match", message };
  }
}
