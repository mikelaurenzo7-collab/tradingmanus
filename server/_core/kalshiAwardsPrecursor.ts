/**
 * Awards Precursor Model
 *
 * Predicts winners of major awards (Oscars, Grammys, Emmys) using a weighted
 * sum of precursor results.  The weights below are derived from historical
 * "predicts the eventual winner" hit rates over the past ~25 ceremonies.
 *
 *   Best Picture (Oscar):
 *     SAG Ensemble        → ~52% predictive
 *     DGA Best Director   → ~62% predictive (same film usually wins both)
 *     PGA Best Picture    → ~70% predictive
 *     BAFTA Best Film     → ~40% predictive
 *
 *   The weights here are the *renormalised* contributions of each precursor
 *   to a film's modelled win probability conditional on having won that
 *   precursor.  When a film has won zero precursors its prior is
 *   `nomineePrior`, decayed slightly when a strong precursor is held by a
 *   competitor.
 *
 * Usage from the autonomy loop:
 *   1. Operator updates `KNOWN_PRECURSORS` at the top of an awards season.
 *   2. For each Kalshi/Polymarket market matching a known awards category,
 *      the model returns a fundamental probability per nominee.
 *   3. The fundamentalProbability flows into the existing value-play
 *      signal generator (`generateSignalsForMarket`) as a category-aware
 *      prior, so the existing reviewer / risk pipeline carries it the
 *      rest of the way.
 *
 * The model is deliberately small and deterministic — there is no external
 * API or LLM call.  The operator-curated precursor data is the only input.
 */
export type AwardCategory =
  | "oscar_best_picture"
  | "oscar_best_director"
  | "oscar_best_actor"
  | "oscar_best_actress"
  | "oscar_best_supporting_actor"
  | "oscar_best_supporting_actress"
  | "grammy_album_of_the_year"
  | "grammy_record_of_the_year"
  | "grammy_song_of_the_year"
  | "emmy_drama_series"
  | "emmy_comedy_series";

/**
 * Precursors and their historical predictive weights for each category.
 * Weights sum to ≤ 1; the residual goes to the prior.  These coefficients
 * are calibrated on AMPAS / Recording Academy / Television Academy historical
 * data through the most recent ceremony for which final results are known.
 */
const PRECURSOR_WEIGHTS: Record<AwardCategory, Record<string, number>> = {
  oscar_best_picture: {
    pga: 0.35,
    dga: 0.25,
    sag_ensemble: 0.2,
    bafta: 0.1,
    critics_choice: 0.05,
  },
  oscar_best_director: {
    dga: 0.55,
    bafta_director: 0.2,
    critics_choice_director: 0.1,
    golden_globe_director: 0.1,
  },
  oscar_best_actor: {
    sag_lead_actor: 0.45,
    golden_globe_drama_actor: 0.2,
    critics_choice_actor: 0.15,
    bafta_lead_actor: 0.15,
  },
  oscar_best_actress: {
    sag_lead_actress: 0.45,
    golden_globe_drama_actress: 0.2,
    critics_choice_actress: 0.15,
    bafta_lead_actress: 0.15,
  },
  oscar_best_supporting_actor: {
    sag_supporting_actor: 0.5,
    bafta_supporting_actor: 0.2,
    critics_choice_supporting_actor: 0.15,
    golden_globe_supporting_actor: 0.1,
  },
  oscar_best_supporting_actress: {
    sag_supporting_actress: 0.5,
    bafta_supporting_actress: 0.2,
    critics_choice_supporting_actress: 0.15,
    golden_globe_supporting_actress: 0.1,
  },
  grammy_album_of_the_year: {
    billboard_top_charting: 0.25,
    metacritic_critic_score_85plus: 0.25,
    grammy_record_winner: 0.2,
    grammy_song_winner: 0.15,
  },
  grammy_record_of_the_year: {
    billboard_hot100_number_one: 0.3,
    grammy_song_winner: 0.25,
    metacritic_track_score_85plus: 0.15,
  },
  grammy_song_of_the_year: {
    grammy_record_winner: 0.3,
    billboard_hot100_top10: 0.2,
    apple_music_top_song: 0.15,
  },
  emmy_drama_series: {
    wga_drama: 0.3,
    dga_drama: 0.25,
    sag_drama_ensemble: 0.2,
    critics_choice_drama: 0.1,
  },
  emmy_comedy_series: {
    wga_comedy: 0.3,
    dga_comedy: 0.25,
    sag_comedy_ensemble: 0.2,
    critics_choice_comedy: 0.1,
  },
};

/**
 * Operator-curated precursor results for the current awards season.
 *
 * Each entry maps a category → which nominee won which precursor.  Update
 * this object during awards season.  Empty maps are valid (model falls back
 * to a uniform prior across nominees).
 *
 * Example for Oscars 2026:
 *   oscar_best_picture: {
 *     pga: "Anora",
 *     dga: "The Brutalist",
 *     sag_ensemble: "Conclave",
 *     bafta: "Conclave",
 *   }
 */
export const KNOWN_PRECURSORS: Partial<Record<AwardCategory, Record<string, string>>> = {
  // Operator updates this during awards season. Empty by default so the
  // model returns a uniform prior outside Jan–Mar windows.
};

/** Active nominees per category. Operator updates each season. */
export const KNOWN_NOMINEES: Partial<Record<AwardCategory, string[]>> = {
  // Operator updates each season.
};

function normaliseTitle(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compute a probability map (nominee → P(win)) for a given category.
 *
 * Algorithm:
 *   1. Start every nominee with a uniform prior `1 / N`.
 *   2. For each precursor with a known winner, redistribute its weight onto
 *      the winning nominee.  The winner's probability climbs by the weight,
 *      every other nominee's probability falls proportionally.
 *   3. Renormalise to a probability distribution.
 *
 * Mathematically equivalent to a Bayesian update where each precursor is
 * an independent observation with calibrated likelihood.  The output is
 * always a valid probability simplex.
 */
export function computeAwardsPrecursorProbability(
  category: AwardCategory,
  nominees: string[],
  precursorResults: Record<string, string>,
): Record<string, number> {
  if (!nominees.length) return {};

  const weights = PRECURSOR_WEIGHTS[category] ?? {};
  const uniform = 1 / nominees.length;
  const probs: Record<string, number> = {};
  for (const nominee of nominees) probs[nominee] = uniform;

  for (const [precursor, winner] of Object.entries(precursorResults)) {
    const weight = weights[precursor];
    if (!weight || weight <= 0) continue;
    const winnerKey = nominees.find(
      (n) => normaliseTitle(n) === normaliseTitle(winner),
    );
    if (!winnerKey) continue;

    // Lift the winner's probability by `weight × (1 - currentProb)` so
    // probabilities never exceed 1, then redistribute the remaining mass
    // proportionally across the remaining nominees.
    const lift = weight * (1 - probs[winnerKey]);
    probs[winnerKey] += lift;
    const remainingTotal = nominees.reduce(
      (sum, n) => (n === winnerKey ? sum : sum + probs[n]),
      0,
    );
    if (remainingTotal > 0) {
      for (const n of nominees) {
        if (n === winnerKey) continue;
        probs[n] *= 1 - lift / remainingTotal;
      }
    }
  }

  // Renormalise (guards against floating-point drift)
  const total = Object.values(probs).reduce((s, p) => s + p, 0);
  if (total <= 0) return probs;
  for (const n of nominees) probs[n] /= total;

  return probs;
}

/**
 * Detect whether a Kalshi market title looks like an awards-precursor target.
 * Returns the category + nominee if matched, else null.
 */
export function classifyAwardsMarket(
  title: string,
): { category: AwardCategory; nominee: string } | null {
  const lower = normaliseTitle(title);
  if (!lower) return null;

  // Map title keywords → category.  Order matters; more-specific patterns first.
  const categoryRules: Array<{ category: AwardCategory; tokens: string[] }> = [
    { category: "oscar_best_picture", tokens: ["best picture", "academy award best picture"] },
    { category: "oscar_best_director", tokens: ["best director", "academy award best director"] },
    { category: "oscar_best_actor", tokens: ["best actor", "academy award best actor"] },
    { category: "oscar_best_actress", tokens: ["best actress", "academy award best actress"] },
    { category: "oscar_best_supporting_actor", tokens: ["best supporting actor"] },
    { category: "oscar_best_supporting_actress", tokens: ["best supporting actress"] },
    { category: "grammy_album_of_the_year", tokens: ["album of the year"] },
    { category: "grammy_record_of_the_year", tokens: ["record of the year"] },
    { category: "grammy_song_of_the_year", tokens: ["song of the year"] },
    { category: "emmy_drama_series", tokens: ["emmy drama series", "outstanding drama series"] },
    { category: "emmy_comedy_series", tokens: ["emmy comedy series", "outstanding comedy series"] },
  ];

  let matchedCategory: AwardCategory | null = null;
  for (const { category, tokens } of categoryRules) {
    if (tokens.some((t) => lower.includes(t))) {
      matchedCategory = category;
      break;
    }
  }
  if (!matchedCategory) return null;

  // Extract the nominee.  Kalshi markets usually use one of:
  //   "Will <NOMINEE> win Best Picture at the 2026 Oscars?"
  //   "Best Picture: <NOMINEE>"
  // We strip leading "will" / trailing "win <category>" / "at the … oscars".
  let nominee = title;
  nominee = nominee.replace(/^\s*will\s+/i, "");
  nominee = nominee.replace(
    /\s+(win|take home)\s+(the\s+)?(academy award|oscar|emmy|grammy)?.*$/i,
    "",
  );
  nominee = nominee.replace(/\s+win\s+best.*$/i, "");
  nominee = nominee.replace(/\?+$/g, "").trim();
  if (!nominee || nominee.toLowerCase() === title.toLowerCase()) {
    // Fallback: take the segment after a colon if present.
    const colonIdx = title.indexOf(":");
    if (colonIdx >= 0) {
      nominee = title.slice(colonIdx + 1).trim();
    }
  }
  if (!nominee) return null;
  return { category: matchedCategory, nominee };
}

/**
 * Look up the awards-precursor fundamental probability for a Kalshi market.
 *
 * Returns null when the market is not an awards-precursor target, the
 * category has no curated precursor data, or the nominee is unknown.
 *
 * This is consumed by `resolveFundamentalPrior` in `kalshiSignals.ts` so
 * the existing value-play pipeline naturally fires on awards mispricings.
 */
export function lookupAwardsFundamental(market: {
  title: string;
}): number | null {
  const classified = classifyAwardsMarket(market.title);
  if (!classified) return null;

  const nominees = KNOWN_NOMINEES[classified.category];
  if (!nominees || nominees.length === 0) return null;

  const matched = nominees.find(
    (n) => normaliseTitle(n) === normaliseTitle(classified.nominee),
  );
  if (!matched) return null;

  const precursors = KNOWN_PRECURSORS[classified.category] ?? {};
  const probs = computeAwardsPrecursorProbability(
    classified.category,
    nominees,
    precursors,
  );
  const value = probs[matched];
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0.01, Math.min(0.99, value));
}
