/**
 * The colours both views of the map are drawn in.
 *
 * Lifted out of topic-map.tsx on 2026-09-07, when the field of cones moved
 * into the same page: the two renderers share a legend and a colour mode, so
 * they have to share the tables those refer to, and neither can import the
 * other without a cycle.
 */
export const PALETTE = [
  "#6cc5ff", "#a98bff", "#5fd6a4", "#ffb454", "#ff7a9c", "#7ce0e0",
  "#c3a3ff", "#ffd166", "#8fd694", "#f4978e", "#9aa6bd",
];
export const colorOf = (clusterId: number) => PALETTE[clusterId % PALETTE.length];

// Journal colors keyed by ISSN-L (stable across re-ingests, unlike the
// enumerate-index journal ids in corpus.json).
export const JOURNAL_COLORS: Record<string, string> = {
  "0022-5002": "#22c55e", // JEAB - green
  "0021-8855": "#ef4444", // JABA - red
  "1998-1929": "#eab308", // BAP - yellow
  "2520-8969": "#9ca3af", // PoBS - gray
  "0889-9401": "#3b82f6", // TAVB - blue
  "0033-2933": "#a855f7", // TPR - purple
  "1072-0847": "#f97316", // BI - orange
  "2372-9414": "#f3ecc9", // BA:RP - warm off-white (yellow-tinted cream)
  "1064-9506": "#ec4899", // BSI - pink
  "0748-8491": "#fda4af", // ETC - rose
  "0376-6357": "#2dd4bf", // Behavioural Processes - teal (kept out of the green band:
  //                        it overlaps JEAB and the two animal-learning journals on the map)
  "1053-0819": "#a5b4fc", // Journal of Behavioral Education - periwinkle
  "1543-4494": "#06b6d4", // Learning & Behavior - cyan
  "2329-8456": "#84cc16", // JEP: Animal Learning and Cognition - lime
  "0145-4455": "#fb923c", // Behavior Modification - light orange
};
export const FALLBACK_JOURNAL_COLOR = "#ec4899"; // any future unmapped journal

/**
 * Reach: how often an article is cited from outside these journals.
 *
 * A magnitude, so one hue getting darker as it rises rather than a set of
 * hues, and the bands are fixed counts rather than quantiles so the same
 * color means the same thing after a refresh, and after a filter. The light
 * ramp darkens with the value against a near-white canvas; the dark ramp
 * brightens against a near-black one, which is the same rule and not a flip
 * of the same swatches.
 *
 * The low end is deliberately the quiet one in both themes. Its contrast
 * against the canvas is under 3:1, which is why the key below spells the
 * bands out in numbers instead of leaving the color to carry them alone.
 */
export const REACH_BANDS = [
  { floor: 0, label: "none" },
  { floor: 1, label: "1-4" },
  { floor: 5, label: "5-19" },
  { floor: 20, label: "20-99" },
  { floor: 100, label: "100+" },
] as const;

export const REACH_LIGHT = ["#bae6fd", "#7dd3fc", "#38bdf8", "#0369a1", "#0c4a6e"];
export const REACH_DARK = ["#0c4a6e", "#0369a1", "#0284c7", "#38bdf8", "#7dd3fc"];
// An article the citation graph has nothing for, in either theme.
export const REACH_UNKNOWN = "#71717a";

export function reachBand(reach: number | null | undefined): number | null {
  if (reach === null || reach === undefined) return null;
  let band = 0;
  REACH_BANDS.forEach((b, i) => {
    if (reach >= b.floor) band = i;
  });
  return band;
}

export function reachColorOf(reach: number | null | undefined, isDark: boolean): string {
  const band = reachBand(reach);
  if (band === null) return REACH_UNKNOWN;
  return (isDark ? REACH_DARK : REACH_LIGHT)[band];
}


export type ColorMode = "topic" | "journal" | "reach";
