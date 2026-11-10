import { useId, type ReactNode } from "react";
import { CapyFigure, type CapyMood, type CapyWho } from "./Capy";
import styles from "./mascots.module.css";

/**
 * The hot spring where Barley (left) and Biscuit (right) haggle.
 * One responsive SVG, 800 x 420 units, scaling to the container width.
 */

export type HotSpringPhase = "idle" | "haggling" | "paused" | "deal" | "walked";

export interface HotSpringProps {
  phase: HotSpringPhase;
  speaker?: CapyWho | null;
  barleyMood?: CapyMood;
  biscuitMood?: CapyMood;
  className?: string;
}

const INK = "#2a1f17";
const W = 800;
const H = 420;

/** Water line at the capybaras, in scene units. */
const WATER_Y = 324;
/** Scale of the 240 unit capybara figure inside the scene. */
const CAPY_SCALE = 1.1;
/** Figure y that sits on the water line. */
const FIGURE_WATER = 228;
const CAPY_Y = Math.round((WATER_Y - FIGURE_WATER * CAPY_SCALE) * 10) / 10;
/** Left edge of Barley's figure box. Biscuit mirrors it around the middle. */
const BARLEY_X = 76;

/*
 * Poses are plain SVG transforms in the figure's own space, so the end state
 * never depends on CSS. Keep in sync with spring-bump and spring-turn-away in
 * mascots.module.css.
 */
const DEAL_POSE = "translate(45 0) rotate(6 100 215)";
const WALKED_POSE = "translate(-22 0) rotate(-9 100 215)";
/** How far the body slides along the water line for each pose, in scene units. */
const POSE_SHIFT: Record<HotSpringPhase, number> = { idle: 0, haggling: 0, paused: 0, deal: 50, walked: -26 };

function describe(phase: HotSpringPhase, speaker: CapyWho | null): string {
  switch (phase) {
    case "deal":
      return "Deal reached. Barley and Biscuit, two capybaras, lean in and bump noses in the hot spring.";
    case "walked":
      return "No deal. Barley and Biscuit, two capybaras, turn away from each other in the hot spring.";
    case "paused":
      return "The haggle is paused. Barley and Biscuit, two capybaras, wait in the hot spring.";
    case "haggling":
      if (speaker === "barley") {
        return "Barley, the buyer's capybara, is speaking to Biscuit, the seller's capybara, as they haggle in a hot spring.";
      }
      if (speaker === "biscuit") {
        return "Biscuit, the seller's capybara, is speaking to Barley, the buyer's capybara, as they haggle in a hot spring.";
      }
      return "Barley, the buyer's capybara, and Biscuit, the seller's capybara, haggle face to face in a hot spring.";
    default:
      if (speaker === "barley") {
        return "Barley, the buyer's capybara, is speaking to Biscuit, the seller's capybara, as they soak in a hot spring.";
      }
      if (speaker === "biscuit") {
        return "Biscuit, the seller's capybara, is speaking to Barley, the buyer's capybara, as they soak in a hot spring.";
      }
      return "Barley, the buyer's capybara, and Biscuit, the seller's capybara, soak in a hot spring, ready to haggle.";
  }
}

/* ------------------------------------------------------------------ */
/* Scenery pieces                                                      */
/* ------------------------------------------------------------------ */

function f(n: number): number {
  return Math.round(n * 10) / 10;
}

interface RockTone {
  fill: string;
  hi: string;
  low: string;
}

const ROCK: Record<"light" | "mid" | "dark", RockTone> = {
  light: { fill: "#c4b7a3", hi: "#ddd3c2", low: "#a89a85" },
  mid: { fill: "#ad9f8a", hi: "#cabdaa", low: "#93846f" },
  dark: { fill: "#948571", hi: "#b5a792", low: "#7b6c59" },
};

function Rock({
  x,
  y,
  w,
  h,
  tone,
  moss = false,
  outline = 0,
}: {
  x: number;
  /** Baseline (bottom) of the rock. */
  y: number;
  w: number;
  h: number;
  tone: keyof typeof ROCK;
  moss?: boolean;
  outline?: number;
}) {
  const c = ROCK[tone];
  // Points are given as fractions of the rock's width and height, measured up from the baseline.
  const p = (fx: number, fy: number) => `${f(x + w * fx)} ${f(y - h * fy)}`;
  const d = `M ${p(0, 0)} C ${p(-0.05, 0.6)} ${p(0.14, 1)} ${p(0.45, 1)} C ${p(0.8, 1)} ${p(1.04, 0.5)} ${p(1, 0)} Z`;
  const shade =
    `M ${p(0.55, 0.96)} C ${p(0.82, 0.92)} ${p(1.02, 0.5)} ${p(1, 0)} ` +
    `L ${p(0.62, 0)} C ${p(0.74, 0.4)} ${p(0.7, 0.75)} ${p(0.55, 0.96)} Z`;
  const shine = `M ${p(0.16, 0.58)} C ${p(0.2, 0.8)} ${p(0.32, 0.9)} ${p(0.46, 0.9)}`;
  const mossD =
    `M ${p(0.1, 0.72)} C ${p(0.2, 1.04)} ${p(0.7, 1.06)} ${p(0.86, 0.74)} ` +
    `C ${p(0.76, 0.66)} ${p(0.66, 0.78)} ${p(0.54, 0.68)} C ${p(0.42, 0.8)} ${p(0.3, 0.62)} ${p(0.1, 0.72)} Z`;
  return (
    <g>
      <path d={d} fill={c.fill} />
      <path d={shade} fill={c.low} opacity={0.75} />
      <path d={shine} fill="none" stroke={c.hi} strokeWidth={f(Math.max(3, h * 0.07))} strokeLinecap="round" />
      {moss ? <path d={mossD} fill="#6fae9c" /> : null}
      {outline > 0 ? <path d={d} fill="none" stroke={INK} strokeWidth={outline} strokeLinejoin="round" /> : null}
    </g>
  );
}

const LEAF = "M 0 0 C 8 -9 20 -11 31 -7 C 23 1 10 4 0 0 Z";

function Bamboo({
  x,
  lean,
  height,
  stalk,
  leaves,
}: {
  x: number;
  lean: number;
  height: number;
  stalk: string;
  /** [distance up the stalk, direction 1 or -1, rotation] */
  leaves: Array<[number, 1 | -1, number]>;
}) {
  const base = 252;
  const nodes: number[] = [];
  for (let d = 38; d < height; d += 46) nodes.push(d);
  return (
    <g transform={`rotate(${lean} ${x} ${base})`}>
      <rect x={x - 5.5} y={base - height} width={11} height={height} rx={4} fill={stalk} />
      <rect x={x + 1.5} y={base - height} width={4} height={height} rx={2} fill="#1f7a78" opacity={0.22} />
      {nodes.map((d) => (
        <path key={d} d={`M ${x - 6.5} ${base - d} L ${x + 6.5} ${base - d}`} stroke="#1f7a78" strokeWidth={2.5} strokeLinecap="round" opacity={0.7} />
      ))}
      {leaves.map(([d, dir, rot], i) => (
        <g key={i} transform={`translate(${x + dir * 4} ${base - d}) scale(${dir} 1) rotate(${rot})`}>
          <path d={LEAF} fill="#2f8a80" />
          <path d={LEAF} fill="#1f7a78" transform="rotate(34) scale(0.86)" />
          <path d={LEAF} fill="#4a9d92" transform="rotate(-30) scale(0.8)" />
        </g>
      ))}
    </g>
  );
}

function Lantern({ x, y, glowId }: { x: number; y: number; glowId: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle className={styles.lanternGlow} cx={0} cy={-78} r={44} fill={`url(#${glowId})`} />
      <rect x={-21} y={-12} width={42} height={14} rx={4} fill="#ad9f8a" />
      <rect x={-7} y={-56} width={14} height={46} fill="#c4b7a3" />
      <rect x={2} y={-56} width={5} height={46} fill="#a89a85" />
      <path d="M -25 -56 L 25 -56 L 19 -66 L -19 -66 Z" fill="#ad9f8a" />
      <rect x={-17} y={-94} width={34} height={28} rx={2} fill="#c4b7a3" />
      <rect x={-8} y={-89} width={16} height={19} rx={3} fill="#f2b33d" />
      <rect x={-5} y={-86} width={10} height={13} rx={2} fill="#fde9bd" />
      <path d="M -34 -92 C -20 -97 -9 -108 0 -119 C 9 -108 20 -97 34 -92 L 30 -87 L -30 -87 Z" fill="#948571" />
      <path d="M -34 -92 C -20 -97 -9 -108 0 -119" fill="none" stroke="#b5a792" strokeWidth={3} strokeLinecap="round" />
      <circle cx={0} cy={-121} r={5.5} fill="#948571" />
    </g>
  );
}

function Yuzu({ x, y, r, leaf = false, variant }: { x: number; y: number; r: number; leaf?: boolean; variant?: string }) {
  const y0 = r * 0.42;
  const hc = Math.sqrt(r * r - y0 * y0);
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx={0} cy={y0 + 1} rx={r + 9} ry={4} fill="none" stroke="#d6f0ea" strokeWidth={2} opacity={0.75} />
      <g className={variant ? `${styles.yuzu} ${variant}` : styles.yuzu}>
        <circle cx={0} cy={0} r={r} fill="#f2b33d" />
        <path
          d={`M ${f(r * 0.5)} ${f(-r * 0.86)} A ${r} ${r} 0 0 1 ${f(r * 0.3)} ${f(r * 0.95)} A ${f(r * 1.25)} ${f(r * 1.25)} 0 0 0 ${f(r * 0.5)} ${f(-r * 0.86)} Z`}
          fill="#dd9420"
          opacity={0.8}
        />
        <ellipse cx={f(-r * 0.36)} cy={f(-r * 0.4)} rx={f(r * 0.3)} ry={f(r * 0.17)} transform={`rotate(-32 ${f(-r * 0.36)} ${f(-r * 0.4)})`} fill="#fff" opacity={0.6} />
        <path d={`M ${f(-hc)} ${f(y0)} A ${r} ${r} 0 0 0 ${f(hc)} ${f(y0)} Z`} fill="#2f8f8a" opacity={0.78} />
        <circle cx={0} cy={0} r={r} fill="none" stroke={INK} strokeWidth={2.6} />
        {leaf ? (
          <path
            d={`M 0 ${f(-r + 1)} c 2 -8 9 -11 16 -9 c -2 7 -8 11 -16 9 Z`}
            fill="#3f9478"
            stroke={INK}
            strokeWidth={2.2}
            strokeLinejoin="round"
          />
        ) : null}
        <circle cx={0} cy={f(-r + 1.5)} r={2.2} fill="#5d7a3a" stroke={INK} strokeWidth={1.4} />
      </g>
      <path d={`M ${f(-hc - 3)} ${f(y0)} Q 0 ${f(y0 + 3.5)} ${f(hc + 3)} ${f(y0)}`} fill="none" stroke="#e4f4f1" strokeWidth={2.2} strokeLinecap="round" />
    </g>
  );
}

function Steam({ x, y, scale = 1, variant, opacity = 0.5 }: { x: number; y: number; scale?: number; variant?: string; opacity?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <g className={variant ? `${styles.steam} ${variant}` : styles.steam} opacity={opacity}>
        <path d="M 0 0 C 17 -14 -7 -33 5 -52 C 15 -68 -5 -85 3 -106 C -11 -86 7 -70 -5 -52 C -17 -34 7 -17 0 0 Z" fill="#ffffff" />
        <path d="M 17 -20 C 27 -30 13 -42 19 -58 C 9 -44 21 -32 17 -20 Z" fill="#ffffff" opacity={0.8} />
      </g>
    </g>
  );
}

function Bucket({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M -24 -30 L 24 -30 L 20 0 C 8 4 -8 4 -20 0 Z" fill="#d9a868" stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <path d="M -22.6 -19 C -8 -15 8 -15 22.6 -19 M -21 -7 C -8 -3 8 -3 21 -7" fill="none" stroke="#8a5a33" strokeWidth={3.2} />
      <ellipse cx={0} cy={-30} rx={24} ry={6.5} fill="#b9814a" stroke={INK} strokeWidth={3} />
      <path
        d="M -6 -34 C 4 -40 18 -38 27 -31 C 29 -22 29 -14 27 -7 C 22 -11 16 -12 10 -10 C 11 -18 6 -26 -6 -34 Z"
        fill="#fbf5ea"
        stroke={INK}
        strokeWidth={3}
        strokeLinejoin="round"
      />
      <path d="M 13.5 -18 C 18 -20 23 -19 27.6 -16" fill="none" stroke="#c8443a" strokeWidth={2.6} />
    </g>
  );
}

const HEART = "M 0 10 C -15 -1 -16 -13 -8.5 -15 C -4 -16 -1 -13.5 0 -9.5 C 1 -13.5 4 -16 8.5 -15 C 16 -13 15 -1 0 10 Z";
const SPARK = "M 0 -10 C 1.6 -3.4 3.4 -1.6 10 0 C 3.4 1.6 1.6 3.4 0 10 C -1.6 3.4 -3.4 1.6 -10 0 C -3.4 -1.6 -1.6 -3.4 0 -10 Z";

function DealBurst({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g transform="translate(0 -38) scale(1.7)">
        <path className={styles.burstHeart} d={HEART} fill="#c8443a" stroke={INK} strokeWidth={2.4} strokeLinejoin="round" />
      </g>
      <g transform="translate(-58 -34)">
        <path className={styles.spark} d={SPARK} fill="#f2b33d" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      </g>
      <g transform="translate(56 -38) scale(1.2)">
        <path className={`${styles.spark} ${styles.sparkB}`} d={SPARK} fill="#f2b33d" stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
      </g>
      <g transform="translate(-36 -78) scale(0.8)">
        <path className={`${styles.spark} ${styles.sparkC}`} d={SPARK} fill="#fde9bd" stroke={INK} strokeWidth={2.2} strokeLinejoin="round" />
      </g>
      <g transform="translate(38 -84) scale(0.7)">
        <path className={`${styles.spark} ${styles.sparkB}`} d={SPARK} fill="#fde9bd" stroke={INK} strokeWidth={2.4} strokeLinejoin="round" />
      </g>
      <circle className={`${styles.spark} ${styles.sparkC}`} cx={-74} cy={-62} r={3.2} fill="#c8443a" />
      <circle className={styles.spark} cx={74} cy={-66} r={3.2} fill="#c8443a" />
      <circle className={`${styles.spark} ${styles.sparkB}`} cx={2} cy={-98} r={3} fill="#f2b33d" />
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Capybaras in the water                                              */
/* ------------------------------------------------------------------ */

function SceneCapy({
  who,
  mood,
  uid,
  phase,
  speaking,
}: {
  who: CapyWho;
  mood: CapyMood;
  uid: string;
  phase: HotSpringPhase;
  speaking: boolean;
}) {
  const pose = phase === "deal" ? DEAL_POSE : phase === "walked" ? WALKED_POSE : undefined;
  const poseClass = phase === "deal" ? styles.bump : phase === "walked" ? styles.turnAway : undefined;
  const idleClass = who === "biscuit" ? `${styles.soak} ${styles.soakLate}` : styles.soak;
  const place =
    who === "barley"
      ? `translate(${BARLEY_X} ${CAPY_Y}) scale(${CAPY_SCALE})`
      : `translate(${W - BARLEY_X} ${CAPY_Y}) scale(${-CAPY_SCALE} ${CAPY_SCALE})`;
  return (
    <g transform={place}>
      <g transform={pose} className={poseClass}>
        <g className={speaking ? styles.speaking : idleClass}>
          <CapyFigure who={who} mood={mood} uid={uid} />
          {phase === "walked" && mood === "firm" ? (
            <g className={styles.huff}>
              <path d="M 245 77 L 253 75.5 M 246 85 L 254 86.5" fill="none" stroke={INK} strokeWidth={3.2} strokeLinecap="round" />
              <path
                d="M 259 81 C 258 75 263 71 268 73 C 272 70 279 73 278 79 C 281 83 278 89 273 88 C 270 91 263 90 262 87 C 259 87 258 84 259 81 Z"
                fill="#ffffff"
                stroke={INK}
                strokeWidth={2.6}
                strokeLinejoin="round"
              />
            </g>
          ) : null}
          {speaking ? (
            <g className={styles.talkMarks} fill="none" strokeLinecap="round">
              <path d="M 250 102 L 262 95 M 253 119 L 267 119 M 250 136 L 262 143" stroke={INK} strokeWidth={8.5} />
              <path d="M 250 102 L 262 95 M 253 119 L 267 119 M 250 136 L 262 143" stroke="#f2b33d" strokeWidth={4} />
            </g>
          ) : null}
        </g>
      </g>
    </g>
  );
}

/**
 * Slides the water marks along with a pose. The attribute carries the end
 * state for static renders, the matching inline style lets CSS ease into it.
 */
function Slide({ dx, children }: { dx: number; children: ReactNode }) {
  return (
    <g className={styles.slide} transform={`translate(${dx} 0)`} style={{ transform: `translateX(${dx}px)` }}>
      {children}
    </g>
  );
}

function WaterLine({ cx, late = false }: { cx: number; late?: boolean }) {
  const y = WATER_Y;
  return (
    <g>
      <ellipse
        className={late ? `${styles.ripple} ${styles.rippleB}` : styles.ripple}
        cx={cx}
        cy={y + 4}
        rx={140}
        ry={14}
        fill="none"
        stroke="#bfe5df"
        strokeWidth={2.5}
        opacity={0.5}
      />
      <path
        d={`M ${cx - 110} ${y + 1} Q ${cx} ${y + 14} ${cx + 110} ${y + 1} Q ${cx} ${y - 5} ${cx - 110} ${y + 1} Z`}
        fill="#d6f0ea"
        opacity={0.8}
      />
      <path
        d={`M ${cx - 126} ${y + 5} Q ${cx} ${y + 24} ${cx + 126} ${y + 5}`}
        fill="none"
        stroke="#bfe5df"
        strokeWidth={3}
        strokeLinecap="round"
        opacity={0.7}
      />
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

export function HotSpring({ phase, speaker = null, barleyMood, biscuitMood, className }: HotSpringProps) {
  const uid = `spring${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  // The nose bump and the walk away are poses of their own, so the speaker cue is dropped there.
  const talkingAllowed = phase !== "deal" && phase !== "walked";
  const who = talkingAllowed ? speaker : null;

  const fallback = (me: CapyWho): CapyMood => {
    if (phase === "deal") return "happy";
    if (phase === "walked") return me === "barley" ? "firm" : "worried";
    if (who === me) return "talking";
    return "idle";
  };
  const moodA = barleyMood ?? fallback("barley");
  const moodB = biscuitMood ?? fallback("biscuit");

  const shift = POSE_SHIFT[phase];
  const barleyCx = f(BARLEY_X + 99 * CAPY_SCALE);
  const biscuitCx = W - barleyCx;
  const haloX = f(BARLEY_X + 160 * CAPY_SCALE);
  const haloY = f(CAPY_Y + 104 * CAPY_SCALE);
  const classes = [styles.scene, phase === "paused" ? styles.paused : "", className ?? ""].filter(Boolean).join(" ");

  const sky = `${uid}-sky`;
  const water = `${uid}-water`;
  const front = `${uid}-front`;
  const glow = `${uid}-glow`;
  const halo = `${uid}-halo`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${W} ${H}`}
      className={classes}
      role="img"
      aria-label={describe(phase, who)}
      focusable="false"
      data-phase={phase}
    >
      <defs>
        <linearGradient id={sky} x1={0} y1={0} x2={0} y2={250} gradientUnits="userSpaceOnUse">
          <stop offset={0} stopColor="#fbf5ea" />
          <stop offset={1} stopColor="#e4f4f1" />
        </linearGradient>
        <linearGradient id={water} x1={0} y1={228} x2={0} y2={420} gradientUnits="userSpaceOnUse">
          <stop offset={0} stopColor="#8fd2c9" />
          <stop offset={0.47} stopColor="#43a19b" />
          <stop offset={0.65} stopColor="#35928e" />
          <stop offset={1} stopColor="#1f7a78" />
        </linearGradient>
        <linearGradient id={front} x1={0} y1={228} x2={0} y2={420} gradientUnits="userSpaceOnUse">
          <stop offset={0.47} stopColor="#43a19b" stopOpacity={0.5} />
          <stop offset={0.65} stopColor="#35928e" stopOpacity={1} />
          <stop offset={1} stopColor="#1f7a78" stopOpacity={1} />
        </linearGradient>
        <radialGradient id={glow}>
          <stop offset={0} stopColor="#f2b33d" stopOpacity={0.55} />
          <stop offset={1} stopColor="#f2b33d" stopOpacity={0} />
        </radialGradient>
        <radialGradient id={halo}>
          <stop offset={0} stopColor="#fde9bd" stopOpacity={0.95} />
          <stop offset={0.6} stopColor="#fde9bd" stopOpacity={0.5} />
          <stop offset={1} stopColor="#fde9bd" stopOpacity={0} />
        </radialGradient>
      </defs>

      {/* sky, sun and hills */}
      <rect width={W} height={H} fill={`url(#${sky})`} />
      <circle cx={400} cy={96} r={62} fill="#fde9bd" opacity={0.45} />
      <circle cx={400} cy={96} r={42} fill="#fde9bd" />
      <path d="M 0 196 C 70 156 150 150 236 180 C 316 142 430 134 520 172 C 600 146 700 142 800 176 L 800 260 L 0 260 Z" fill="#d6ece7" />
      <path d="M 0 222 C 100 194 200 200 300 216 C 420 196 520 200 620 212 C 700 200 760 202 800 208 L 800 260 L 0 260 Z" fill="#bfe5df" />

      {/* bamboo and lantern */}
      <Bamboo x={30} lean={-4} height={300} stalk="#7dbcab" leaves={[[150, 1, -20], [226, -1, -10], [250, 1, -36]]} />
      <Bamboo x={58} lean={2} height={300} stalk="#93c9b9" leaves={[[120, 1, -8], [196, 1, -30]]} />
      <Bamboo x={84} lean={6} height={236} stalk="#7dbcab" leaves={[[168, 1, -22], [226, 1, -48]]} />
      <Bamboo x={782} lean={3} height={300} stalk="#7dbcab" leaves={[[160, -1, -18], [236, -1, -34]]} />
      <Bamboo x={758} lean={-2} height={270} stalk="#93c9b9" leaves={[[130, -1, -10], [214, -1, -40]]} />
      <Lantern x={704} y={238} glowId={glow} />

      {/* far bank and water */}
      <path d="M 0 236 C 200 226 600 226 800 236 L 800 270 L 0 270 Z" fill="#e7d8bd" />
      <path d="M 0 254 C 120 238 280 234 400 234 C 520 234 680 238 800 254 L 800 420 L 0 420 Z" fill={`url(#${water})`} />

      {/* rocks along the far edge */}
      <Rock x={-24} y={262} w={96} h={70} tone="dark" moss />
      <Rock x={52} y={256} w={74} h={46} tone="light" />
      <Rock x={112} y={252} w={100} h={60} tone="mid" />
      <Rock x={198} y={248} w={66} h={36} tone="light" moss />
      <Rock x={252} y={246} w={88} h={46} tone="dark" />
      <Rock x={330} y={244} w={62} h={30} tone="light" />
      <Rock x={382} y={244} w={76} h={38} tone="mid" moss />
      <Rock x={448} y={244} w={58} h={28} tone="light" />
      <Rock x={496} y={246} w={90} h={48} tone="dark" />
      <Rock x={574} y={248} w={68} h={38} tone="light" />
      <Rock x={628} y={252} w={104} h={56} tone="mid" moss />
      <Rock x={716} y={256} w={72} h={46} tone="light" />
      <Rock x={764} y={262} w={70} h={66} tone="dark" />

      {/* surface glints */}
      <g fill="none" stroke="#bfe5df" strokeWidth={3} strokeLinecap="round" opacity={0.6}>
        <path className={styles.shimmer} d="M 96 284 h 54" />
        <path className={`${styles.shimmer} ${styles.shimmerB}`} d="M 372 272 h 56" />
        <path className={styles.shimmer} d="M 660 288 h 60" />
        <path className={`${styles.shimmer} ${styles.shimmerB}`} d="M 356 296 h 30" />
      </g>

      {/* steam behind the pair */}
      <Steam x={60} y={292} scale={1.1} opacity={0.55} />
      {phase === "deal" ? null : <Steam x={400} y={262} scale={1.05} variant={styles.steamB} opacity={0.5} />}
      <Steam x={736} y={290} scale={1.1} variant={styles.steamC} opacity={0.55} />

      {/* the pair */}
      <Slide dx={shift}>
        <ellipse cx={barleyCx} cy={WATER_Y + 8} rx={134} ry={18} fill="#145453" opacity={0.28} />
      </Slide>
      <Slide dx={-shift}>
        <ellipse cx={biscuitCx} cy={WATER_Y + 8} rx={134} ry={18} fill="#145453" opacity={0.28} />
      </Slide>
      {who === "barley" ? <circle className={styles.halo} cx={haloX} cy={haloY} r={150} fill={`url(#${halo})`} /> : null}
      {who === "biscuit" ? <circle className={styles.halo} cx={W - haloX} cy={haloY} r={150} fill={`url(#${halo})`} /> : null}
      <SceneCapy who="barley" mood={moodA} uid={`${uid}-a`} phase={phase} speaking={who === "barley"} />
      <SceneCapy who="biscuit" mood={moodB} uid={`${uid}-b`} phase={phase} speaking={who === "biscuit"} />

      {/* water in front of them */}
      <rect x={0} y={WATER_Y} width={W} height={H - WATER_Y} fill={`url(#${front})`} />
      <Slide dx={shift}>
        <WaterLine cx={barleyCx} />
      </Slide>
      <Slide dx={-shift}>
        <WaterLine cx={biscuitCx} late />
      </Slide>
      <g fill="none" stroke="#bfe5df" strokeWidth={3} strokeLinecap="round" opacity={0.5}>
        <path className={styles.shimmer} d="M 250 356 h 70" />
        <path className={`${styles.shimmer} ${styles.shimmerB}`} d="M 470 348 h 84" />
        <path className={styles.shimmer} d="M 388 402 h 60" />
        <path className={`${styles.shimmer} ${styles.shimmerB}`} d="M 204 398 h 40" />
        <path className={styles.shimmer} d="M 560 404 h 46" />
      </g>

      {/* floating yuzu */}
      <Yuzu x={206} y={380} r={12} />
      <Yuzu x={356} y={390} r={15} leaf variant={styles.yuzuB} />
      <Yuzu x={436} y={366} r={11.5} variant={styles.yuzuC} />
      <Yuzu x={572} y={392} r={13.5} leaf />
      <Yuzu x={404} y={300} r={10} variant={styles.yuzuB} />

      {/* near rocks */}
      <Rock x={-46} y={436} w={176} h={96} tone="dark" outline={3.5} moss />
      <Rock x={92} y={432} w={86} h={42} tone="mid" outline={3.5} />
      <Rock x={672} y={436} w={176} h={100} tone="dark" outline={3.5} />
      <Rock x={628} y={432} w={80} h={40} tone="light" outline={3.5} moss />

      <Bucket x={748} y={356} />

      {/* steam in front */}
      <Steam x={292} y={408} scale={0.62} variant={styles.steamB} opacity={0.4} />
      <Steam x={506} y={404} scale={0.62} opacity={0.4} />

      {phase === "deal" ? <DealBurst x={W / 2} y={152} /> : null}
    </svg>
  );
}
