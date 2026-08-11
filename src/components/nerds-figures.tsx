import { LAYOUT_SAMPLE } from "@/components/nerds-figure-data";

// Static SVG figures for the For Nerds page. Hand-authored rather than drawn
// with a chart library: they are diagrams of a process, not plots of data, and
// they need to read on both the light and dark ground. Strokes use
// currentColor so they follow the surrounding text color; the one accent hue
// per figure is a Tailwind fill/stroke utility with a dark: variant, since a
// single literal hex that reads well on white tends to disappear on black.

const FIG = "my-9";
const CAPTION = "mt-3 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400";
const SVG = "w-full text-neutral-400 dark:text-neutral-500";
const BOX_TEXT = "fill-neutral-800 dark:fill-neutral-200";
const SUB_TEXT = "fill-neutral-500 dark:fill-neutral-400";
const ACCENT_FILL = "fill-sky-600 dark:fill-sky-400";
const ACCENT_STROKE = "stroke-sky-600 dark:stroke-sky-400";

function Arrowhead({ id }: { id: string }) {
  return (
    <defs>
      <marker
        id={id}
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="6"
        markerHeight="6"
        orient="auto-start-reverse"
      >
        <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
      </marker>
    </defs>
  );
}

function Box({
  x,
  y,
  w,
  h,
  line1,
  line2,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  line1: string;
  line2?: string;
}) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={6}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
      />
      <text
        x={cx}
        y={line2 ? cy - 2 : cy + 4}
        textAnchor="middle"
        fontSize={12}
        className={BOX_TEXT}
      >
        {line1}
      </text>
      {line2 && (
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize={11} className={SUB_TEXT}>
          {line2}
        </text>
      )}
    </g>
  );
}

export function PipelineFigure({
  vocabSize,
  svdDims,
  topicCount,
}: {
  vocabSize: number;
  svdDims: number;
  topicCount: number;
}) {
  return (
    <figure className={FIG}>
      <svg
        viewBox="0 0 900 220"
        className={SVG}
        role="img"
        aria-label={`Pipeline: title and abstract become a ${vocabSize.toLocaleString()}-term TF-IDF vector, compressed by SVD to ${svdDims} numbers per article. Cosine distance on those numbers gives related articles and suggested reviewers; Ward linkage on the same numbers gives ${topicCount} topics and the map position.`}
      >
        <Arrowhead id="pipe-arrow" />

        <Box x={10} y={80} w={170} h={52} line1="Title + abstract" />
        <Box
          x={230}
          y={80}
          w={170}
          h={52}
          line1="TF-IDF vector"
          line2={`${vocabSize.toLocaleString()} terms`}
        />
        <Box x={450} y={80} w={170} h={52} line1={`${svdDims} numbers`} line2="per article" />
        <Box x={700} y={20} w={190} h={52} line1="Related articles," line2="suggested reviewers" />
        <Box x={700} y={140} w={190} h={52} line1={`${topicCount} topics`} line2="map islands" />

        <line
          x1={180}
          y1={106}
          x2={224}
          y2={106}
          stroke="currentColor"
          strokeWidth={1.25}
          markerEnd="url(#pipe-arrow)"
        />
        <text x={202} y={98} textAnchor="middle" fontSize={10} fill="currentColor">
          tokenize
        </text>

        <line
          x1={400}
          y1={106}
          x2={444}
          y2={106}
          stroke="currentColor"
          strokeWidth={1.25}
          markerEnd="url(#pipe-arrow)"
        />
        <text x={422} y={98} textAnchor="middle" fontSize={10} fill="currentColor">
          SVD
        </text>

        <path
          d="M 535 80 V 46 H 694"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.25}
          markerEnd="url(#pipe-arrow)"
        />
        <text x={614} y={38} textAnchor="middle" fontSize={10} fill="currentColor">
          cosine distance
        </text>

        <path
          d="M 535 132 V 166 H 694"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.25}
          markerEnd="url(#pipe-arrow)"
        />
        <text x={614} y={158} textAnchor="middle" fontSize={10} fill="currentColor">
          Ward linkage
        </text>
      </svg>
      <figcaption className={CAPTION}>
        Both outputs hang off the same {svdDims} numbers. Similarity is read straight off
        them; the topics and the map position are two further steps downstream, which is
        why screen distance is the loosest of the three.
      </figcaption>
    </figure>
  );
}

// Twelve leaves, four groups below the cut. Heights are hand-set to show the
// shape of the thing (merge closest pair, repeat, cut once) rather than to
// reproduce any particular subtree of the real 6,926-leaf dendrogram.
const LEAVES = [45, 100, 155, 210, 265, 320, 375, 430, 485, 540, 595, 650];
const CUT_Y = 105;

export function DendrogramFigure({
  topicCount,
  articles,
}: {
  topicCount: number;
  articles: number;
}) {
  const n = (a: number, b: number) => (a + b) / 2;
  const g1 = n(n(LEAVES[0], LEAVES[1]), LEAVES[2]);
  const g2 = n(n(LEAVES[3], LEAVES[4]), LEAVES[5]);
  const g3 = n(n(LEAVES[6], LEAVES[7]), n(LEAVES[8], LEAVES[9]));
  const g4 = n(LEAVES[10], LEAVES[11]);

  return (
    <figure className={FIG}>
      <svg
        viewBox="0 0 760 200"
        className={SVG}
        role="img"
        aria-label={`A dendrogram of twelve articles. Ward linkage merges the closest pair repeatedly, building a tree; one horizontal cut across the tree yields the topics. Cutting this tree gives four groups; the actual cut used in the landscape gives ${topicCount}.`}
      >
        {LEAVES.map((x) => (
          <circle key={x} cx={x} cy={165} r={2.5} fill="currentColor" />
        ))}

        <g fill="none" strokeWidth={1.5} className={ACCENT_STROKE}>
          <path d={`M ${LEAVES[0]} 165 V 140 H ${LEAVES[1]} V 165`} />
          <path d={`M ${n(LEAVES[0], LEAVES[1])} 140 V 125 H ${LEAVES[2]} V 165`} />
          <path d={`M ${LEAVES[3]} 165 V 138 H ${LEAVES[4]} V 165`} />
          <path d={`M ${n(LEAVES[3], LEAVES[4])} 138 V 122 H ${LEAVES[5]} V 165`} />
          <path d={`M ${LEAVES[6]} 165 V 142 H ${LEAVES[7]} V 165`} />
          <path d={`M ${LEAVES[8]} 165 V 136 H ${LEAVES[9]} V 165`} />
          <path
            d={`M ${n(LEAVES[6], LEAVES[7])} 142 V 118 H ${n(LEAVES[8], LEAVES[9])} V 136`}
          />
          <path d={`M ${LEAVES[10]} 165 V 145 H ${LEAVES[11]} V 165`} />
        </g>

        <g fill="none" stroke="currentColor" strokeWidth={1.25}>
          <path d={`M ${g1} 125 V 88 H ${g2} V 122`} />
          <path d={`M ${g3} 118 V 80 H ${g4} V 145`} />
          <path d={`M ${n(g1, g2)} 88 V 45 H ${n(g3, g4)} V 80`} />
        </g>

        <line
          x1={20}
          y1={CUT_Y}
          x2={740}
          y2={CUT_Y}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="5 4"
        />
        <text x={740} y={CUT_Y - 7} textAnchor="end" fontSize={11} className={BOX_TEXT}>
          one cut, {topicCount} topics
        </text>
        <text x={20} y={188} fontSize={10} fill="currentColor">
          each dot is an article
        </text>
      </svg>
      <figcaption className={CAPTION}>
        Ward repeatedly merges whichever pair is closest relative to cluster size, building one tree over
        every article. The topics are then derived from whatever is below a single horizontal cut. 
        This is drawn with 12 articles and 4 groups. The real tree has{" "}
        {articles.toLocaleString()} leaves, and the cut is set to give {topicCount}.
      </figcaption>
    </figure>
  );
}

// Real numbers, from the "Animal, experimental, drug, theory" topic (193
// articles). Chosen because it is a topic where the two scorings actually
// disagree: sorted by raw in-topic mean the label would read "research,
// experimental, animal, learning". Regenerate these if the topic stops
// existing - a refresh reshuffles cluster boundaries, and the previous
// example topic ("Theory, evolutionary, selection, operant") did not survive
// one.
const SCORE_ROWS = [
  { term: "research", inside: 0.0248, outside: 0.0205, note: "drops out" },
  { term: "experimental", inside: 0.0234, outside: 0.0076 },
  { term: "animal", inside: 0.0233, outside: 0.0043 },
  { term: "learning", inside: 0.0212, outside: 0.0098, note: "drops out" },
  { term: "theory", inside: 0.0197, outside: 0.0048 },
  { term: "drug", inside: 0.0167, outside: 0.0011 },
];

export function LabelScoreFigure() {
  const scale = 19000;
  const x0 = 118;
  const rowH = 28;
  const top = 54;

  return (
    <figure className={FIG}>
      <svg
        viewBox="0 0 760 246"
        className={SVG}
        role="img"
        aria-label="Six candidate terms for one topic. Each bar is the term's mean TF-IDF inside the topic, split into the part that is background (its mean outside the topic) and the part that is left over."
      >
        <rect x={x0} y={18} width={12} height={10} className="fill-neutral-300 dark:fill-neutral-700" />
        <text x={x0 + 18} y={27} fontSize={11} fill="currentColor">
          mean outside the topic
        </text>
        <rect x={x0 + 168} y={18} width={12} height={10} className={ACCENT_FILL} />
        <text x={x0 + 186} y={27} fontSize={11} fill="currentColor">
          what is left - the score that names it
        </text>

        {SCORE_ROWS.map((row, i) => {
          const y = top + i * rowH;
          const greyW = row.outside * scale;
          const accentW = (row.inside - row.outside) * scale;
          return (
            <g key={row.term}>
              <text
                x={x0 - 10}
                y={y + 11}
                textAnchor="end"
                fontSize={12}
                className={row.note ? SUB_TEXT : BOX_TEXT}
              >
                {row.term}
              </text>
              <rect
                x={x0}
                y={y}
                width={greyW}
                height={13}
                className="fill-neutral-300 dark:fill-neutral-700"
              />
              <rect x={x0 + greyW} y={y} width={accentW} height={13} className={ACCENT_FILL} />
              {row.note && (
                <text
                  x={x0 + greyW + accentW + 10}
                  y={y + 11}
                  fontSize={10}
                  fill="currentColor"
                >
                  {row.note}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className={CAPTION}>
        One topic from the landscape, its six highest-scoring candidate terms. Ranked by raw in-topic
        frequency the label would read <em>research, experimental, animal, learning</em> -
        but <em>research</em> and <em>learning</em> are nearly as common everywhere else
        in a behavior-analysis corpus. Subtracting the outside mean leaves{" "}
        <em>animal, experimental, drug, theory</em>.
      </figcaption>
    </figure>
  );
}

const GROUP_COLORS = ["#6cc5ff", "#a98bff", "#5fd6a4", "#ffb454", "#ff7a9c"];
const OTHER_COLOR = "currentColor";

function Panel({
  ox,
  points,
  groups,
  title,
}: {
  ox: number;
  points: number[][];
  groups: number[];
  title: string;
}) {
  const w = 350;
  const h = 250;
  const oy = 34;
  const pad = 12;
  return (
    <g>
      <text x={ox + w / 2} y={24} textAnchor="middle" fontSize={12} className={BOX_TEXT}>
        {title}
      </text>
      <rect
        x={ox}
        y={oy}
        width={w}
        height={h}
        rx={4}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        opacity={0.35}
      />
      {points.map((p, i) => {
        const g = groups[i];
        return (
          <circle
            key={i}
            cx={ox + pad + (p[0] / 100) * (w - pad * 2)}
            cy={oy + pad + (p[1] / 100) * (h - pad * 2)}
            r={2.4}
            fill={g < GROUP_COLORS.length ? GROUP_COLORS[g] : OTHER_COLOR}
            opacity={g < GROUP_COLORS.length ? 0.9 : 0.35}
          />
        );
      })}
    </g>
  );
}

const SHORT_NAMES = ["Foraging", "Discounting", "Equivalence", "Autism, children", "Schedules"];

export function LayoutFigure() {
  const { global: globalPts, islands, group } = LAYOUT_SAMPLE;
  return (
    <figure className={FIG}>
      <svg
        viewBox="0 0 760 330"
        className={SVG}
        role="img"
        aria-label="The same 395 articles laid out two ways. A single global projection smears five colored topics into one continuous cloud. The two-level island layout separates them into distinct clumps."
      >
        <Panel ox={10} points={globalPts} groups={group} title="One global projection" />
        <Panel ox={400} points={islands} groups={group} title="Two-level island layout" />
        <g>
          {SHORT_NAMES.map((name, i) => {
            const x = 12 + i * 132;
            return (
              <g key={name}>
                <circle cx={x} cy={315} r={3.5} fill={GROUP_COLORS[i]} />
                <text x={x + 9} y={319} fontSize={10} fill="currentColor">
                  {name}
                </text>
              </g>
            );
          })}
          <circle cx={12 + 5 * 132} cy={315} r={3.5} fill="currentColor" opacity={0.35} />
          <text x={21 + 5 * 132} y={319} fontSize={10} fill="currentColor">
            everything else
          </text>
        </g>
      </svg>
      <figcaption className={CAPTION}>
        The same 395 articles, drawn from five topics plus a background sample. The panel
        on the right holds the coordinates the landscape actually uses. The one on the
        left is a real projection too, not a sketch. It is what a single multidimensional
        scaling of these articles produces. The five topics are all in there, just
        overlapping. Laying out each topic around its own centroid is what makes them
        separable by eye.
      </figcaption>
    </figure>
  );
}
