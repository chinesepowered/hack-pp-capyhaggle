import { useId, type ReactNode } from "react";
import styles from "./mascots.module.css";

/**
 * Original mascot art for Capy vs Capy.
 *
 * Barley is the buyer's agent (walnut fur, round glasses, pencil behind the ear).
 * Biscuit is the seller's agent (golden fur, coral scarf, a little forelock).
 *
 * Everything is drawn in a 240 x 240 box, facing right. The bottom edge is the
 * water line, so the figure can sit in the hot spring or peek over a card edge.
 */

export type CapyMood = "idle" | "thinking" | "talking" | "happy" | "firm" | "worried";

export type CapyWho = "barley" | "biscuit";

export interface CapyProps {
  mood?: CapyMood;
  size?: number;
  flip?: boolean;
  className?: string;
  title?: string;
}

export interface CapyAvatarProps {
  size?: number;
  className?: string;
}

const INK = "#2a1f17";

interface Coat {
  fur: string;
  shade: string;
  light: string;
  muzzle: string;
  earInner: string;
  nose: string;
  noseShine: string;
  blush: string;
  avatarBg: string;
  avatarRing: string;
}

const COATS: Record<CapyWho, Coat> = {
  barley: {
    fur: "#8a5a33",
    shade: "#6c4424",
    light: "#c9a27a",
    muzzle: "#b88b60",
    earInner: "#5c3920",
    nose: "#553622",
    noseShine: "#7a5740",
    blush: "#c8704f",
    avatarBg: "#bfe5df",
    avatarRing: "#1f7a78",
  },
  biscuit: {
    fur: "#c98f55",
    shade: "#a66f3b",
    light: "#f4dcb4",
    muzzle: "#f0d3a6",
    earInner: "#9b6237",
    nose: "#93603c",
    noseShine: "#b98860",
    blush: "#e8806c",
    avatarBg: "#fde9bd",
    avatarRing: "#c8443a",
  },
};

/* ------------------------------------------------------------------ */
/* Geometry (240 x 240 box, facing right)                              */
/* ------------------------------------------------------------------ */

/* The body runs past the 240 box so the hot spring can show it under water. */
const BODY =
  "M 12 276 L 12 246 C 8 196 26 150 68 130 C 96 119 126 118 148 128 C 174 140 188 194 186 246 L 186 276 Z";
const BELLY = "M 196 150 C 170 150 140 168 128 200 C 122 216 122 232 124 246 L 124 276 L 190 276 Z";

/* A long brick of a head: flat top line, deep blunt muzzle, heavy jowl. */
const HEAD =
  "M 95 62 C 114 53 144 51 160 53 C 168 48 181 48 189 55 C 203 55 216 56 224 60 " +
  "C 232 63 237 70 238 82 C 239 104 239 124 235 138 C 231 152 214 160 190 160 " +
  "C 164 160 134 164 110 156 C 91 149 79 130 78 108 C 77 88 83 70 95 62 Z";

const MUZZLE =
  "M 246 94 C 228 92 206 98 190 114 C 176 128 168 150 174 172 L 250 172 Z";

/* Wide, flat nose pad wrapped over the top front corner of the muzzle. */
const NOSE =
  "M 204 64 C 214 58 232 60 242 68 L 244 86 C 234 91 222 91 213 88 C 204 85 198 72 204 64 Z";

const EAR_NEAR = "M 88 67 C 82 55 86 42 96 40 C 107 38 113 49 110 61";
const EAR_NEAR_INNER = "M 93 60 C 91 53 93 47 97 46 C 102 45 104 52 103 58 Z";
const EAR_FAR = "M 117 58 C 115 47 120 39 128 40 C 136 41 139 50 136 57 Z";

const EYE_NEAR = { cx: 134, cy: 91, rx: 9, ry: 10.5 };
const EYE_FAR = { cx: 175, cy: 84, rx: 7, ry: 9.5 };

/* ------------------------------------------------------------------ */
/* Face pieces                                                         */
/* ------------------------------------------------------------------ */

interface EyeSpec {
  /** 0 = wide open, 1 = shut. Share of the eye hidden under the upper lid. */
  lid: number;
  /** Degrees. Positive tips the lid down toward the nose bridge (stern). */
  tilt: number;
  closed?: "smile";
}

interface BrowSpec {
  outer: number;
  inner: number;
  arch: number;
}

interface FaceSpec {
  eye: EyeSpec;
  /** Far eye, when it differs from the near one. */
  eyeFar?: EyeSpec;
  browNear: BrowSpec;
  browFar: BrowSpec;
  blush: number;
}

const FACES: Record<CapyMood, FaceSpec> = {
  idle: {
    eye: { lid: 0.34, tilt: 0 },
    browNear: { outer: 0, inner: 0, arch: -2 },
    browFar: { outer: 0, inner: 0, arch: -2 },
    blush: 0.5,
  },
  thinking: {
    eye: { lid: 0.16, tilt: 0 },
    eyeFar: { lid: 0.5, tilt: 4 },
    browNear: { outer: -6, inner: -7, arch: -4 },
    browFar: { outer: 1, inner: 4, arch: 0 },
    blush: 0.4,
  },
  talking: {
    eye: { lid: 0.2, tilt: 0 },
    browNear: { outer: -3, inner: -3, arch: -3 },
    browFar: { outer: -3, inner: -3, arch: -3 },
    blush: 0.6,
  },
  happy: {
    eye: { lid: 0, tilt: 0, closed: "smile" },
    browNear: { outer: -4, inner: -4, arch: -4 },
    browFar: { outer: -4, inner: -4, arch: -4 },
    blush: 1,
  },
  firm: {
    eye: { lid: 0.48, tilt: 9 },
    browNear: { outer: -3, inner: 6, arch: 0 },
    browFar: { outer: -3, inner: 6, arch: 0 },
    blush: 0.25,
  },
  worried: {
    eye: { lid: 0.12, tilt: -8 },
    browNear: { outer: 4, inner: -5, arch: -1 },
    browFar: { outer: 4, inner: -5, arch: -1 },
    blush: 0.35,
  },
};

/** Biscuit keeps the eyes a little wider open than Barley (warm and chatty vs dry and practical). */
function gaze(eye: EyeSpec, who: CapyWho): EyeSpec {
  if (eye.closed) return eye;
  const lid = who === "biscuit" ? eye.lid - 0.07 : eye.lid + 0.02;
  return { ...eye, lid: Math.min(0.9, Math.max(0.04, lid)) };
}

/** Barley's brows sit a touch flatter and lower (dry, practical). Biscuit's arch more (open, chatty). */
function temper(brow: BrowSpec, who: CapyWho): BrowSpec {
  return who === "barley"
    ? { outer: brow.outer, inner: brow.inner + 1.4, arch: brow.arch + 1.5 }
    : { outer: brow.outer, inner: brow.inner - 0.6, arch: brow.arch - 1.2 };
}

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

function Eye({
  cx,
  cy,
  rx,
  ry,
  spec,
  inner,
  sw,
}: {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  spec: EyeSpec;
  /** +1 when the nose bridge is to the right of this eye, -1 when to the left. */
  inner: 1 | -1;
  sw: number;
}) {
  if (spec.closed === "smile") {
    return (
      <path
        d={`M ${r1(cx - rx - 1.5)} ${r1(cy + 3)} Q ${cx} ${r1(cy - ry * 0.95)} ${r1(cx + rx + 1.5)} ${r1(cy + 3)}`}
        fill="none"
        stroke={INK}
        strokeWidth={sw}
        strokeLinecap="round"
      />
    );
  }
  const y0 = cy - ry + spec.lid * 2 * ry;
  const dx = rx * Math.sqrt(Math.max(0, 1 - ((y0 - cy) / ry) ** 2));
  const large = y0 < cy ? 1 : 0;
  const hr = rx * 0.3;
  const hy = Math.max(y0 + hr + 1.6, cy - ry * 0.32);
  return (
    <g transform={`rotate(${spec.tilt * inner} ${cx} ${cy})`}>
      <path
        d={`M ${r1(cx - dx)} ${r1(y0)} A ${rx} ${ry} 0 ${large} 0 ${r1(cx + dx)} ${r1(y0)} Z`}
        fill={INK}
      />
      <circle cx={r1(cx + rx * 0.3)} cy={r1(hy)} r={r1(hr)} fill="#fff" />
      <circle cx={r1(cx - rx * 0.3)} cy={r1(cy + ry * 0.45)} r={r1(hr * 0.5)} fill="#fff" opacity={0.6} />
      <path
        d={`M ${r1(cx - dx - 2.5)} ${r1(y0)} L ${r1(cx + dx + 2.5)} ${r1(y0)}`}
        stroke={INK}
        strokeWidth={sw * 0.85}
        strokeLinecap="round"
      />
    </g>
  );
}

function Brow({
  cx,
  cy,
  half,
  spec,
  inner,
  sw,
}: {
  cx: number;
  cy: number;
  half: number;
  spec: BrowSpec;
  inner: 1 | -1;
  sw: number;
}) {
  const xo = cx - half * inner;
  const xi = cx + half * inner;
  const yo = cy + spec.outer;
  const yi = cy + spec.inner;
  return (
    <path
      d={`M ${r1(xo)} ${r1(yo)} Q ${cx} ${r1((yo + yi) / 2 + spec.arch)} ${r1(xi)} ${r1(yi)}`}
      fill="none"
      stroke={INK}
      strokeWidth={sw}
      strokeLinecap="round"
    />
  );
}

const MOUTH_FILL = "#5a2722";
const TONGUE = "#e68f80";

function Mouth({ mood, who, sw }: { mood: CapyMood; who: CapyWho; sw: number }) {
  const line = { fill: "none", stroke: INK, strokeWidth: sw * 0.85, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const philtrum = <path d="M 221 90 C 220 102 217 114 213 123" {...line} />;

  if (mood === "talking" || mood === "happy") {
    const happy = mood === "happy";
    const lip = happy
      ? "M 183 120 C 192 129 205 129 213 123 C 217 128 223 128 228 124"
      : "M 187 125 C 196 129 206 127 213 123 C 217 127 222 128 226 126";
    const open = happy
      ? "M 183 120 C 192 129 205 129 213 123 C 217 128 223 128 228 124 C 228 139 217 149 204 148 C 192 147 184 135 183 120 Z"
      : "M 187 125 C 196 129 206 127 213 123 C 217 127 222 128 226 126 C 226 138 216 146 205 145 C 195 144 188 136 187 125 Z";
    const tongue = happy
      ? "M 193 141 C 198 136 210 136 216 143 C 212 148 199 149 193 141 Z"
      : "M 195 140 C 200 136 209 136 214 141 C 210 146 200 146 195 140 Z";
    return (
      <g>
        {philtrum}
        <g className={happy ? undefined : styles.talkMouth}>
          <path d={open} fill={MOUTH_FILL} stroke={INK} strokeWidth={sw * 0.85} strokeLinejoin="round" />
          <path d={tongue} fill={TONGUE} />
        </g>
        <path d={lip} {...line} />
      </g>
    );
  }

  // Resting face: Biscuit smiles a little wider than Barley.
  let near = who === "biscuit" ? "M 213 123 C 206 136 190 137 180 126" : "M 213 123 C 207 132 194 134 185 128";
  let far = "M 213 123 C 217 129 223 130 228 126";
  if (mood === "firm") {
    near = "M 213 123 C 205 125 195 125 186 130";
    far = "M 213 123 C 218 125 223 126 227 128";
  } else if (mood === "worried") {
    near = "M 213 123 C 208 128 203 122 197 127 C 194 129 191 128 189 131";
    far = "M 213 123 C 217 126 222 126 226 129";
  } else if (mood === "thinking") {
    near = "M 213 123 C 209 127 202 128 197 124 C 195 122 195 119 197 118";
    far = "M 213 123 C 217 127 222 127 226 124";
  }
  return (
    <g>
      {philtrum}
      <path d={near} {...line} />
      <path d={far} {...line} />
    </g>
  );
}

function ThoughtDots() {
  return (
    <g className={styles.thought}>
      <circle cx={171} cy={41} r={3} fill="#fff" stroke={INK} strokeWidth={2.5} />
      <circle cx={180} cy={31} r={4.5} fill="#fff" stroke={INK} strokeWidth={2.5} />
      <rect x={186} y={3} width={50} height={25} rx={12.5} fill="#fff" stroke={INK} strokeWidth={3} />
      <circle className={styles.thoughtDot} cx={199} cy={15.5} r={3.4} fill={INK} />
      <circle className={`${styles.thoughtDot} ${styles.d2}`} cx={211} cy={15.5} r={3.4} fill={INK} />
      <circle className={`${styles.thoughtDot} ${styles.d3}`} cx={223} cy={15.5} r={3.4} fill={INK} />
    </g>
  );
}

function SweatDrop() {
  return (
    <path
      className={styles.sweat}
      d="M 68 58 C 64 65 61 70 61 74 C 61 79 65 82 69 82 C 73 82 76 78 75 73 C 74 68 71 64 68 58 Z"
      fill="#bfe5df"
      stroke={INK}
      strokeWidth={2.5}
      strokeLinejoin="round"
    />
  );
}

/* ------------------------------------------------------------------ */
/* Accessories                                                         */
/* ------------------------------------------------------------------ */

function Glasses({ sw, bold }: { sw: number; bold: boolean }) {
  const lens = bold ? 0.82 : 0.62;
  return (
    <g>
      <path d="M 116.2 89 C 110 86 103 80 98 72" fill="none" stroke={INK} strokeWidth={sw} strokeLinecap="round" />
      <circle cx={134} cy={92} r={18} fill="#f1faf7" fillOpacity={lens} stroke={INK} strokeWidth={sw} />
      <ellipse cx={175.5} cy={85} rx={14} ry={17} fill="#f1faf7" fillOpacity={lens} stroke={INK} strokeWidth={sw} />
      <path d="M 151.6 88 C 154 82 158 81 161.8 83" fill="none" stroke={INK} strokeWidth={sw} strokeLinecap="round" />
    </g>
  );
}

function GlassesGlint() {
  return (
    <g fill="none" stroke="#fff" strokeLinecap="round" opacity={0.9}>
      <path d="M 122.5 86 C 124 81 127 78.5 131 77.5" strokeWidth={2.6} />
      <path d="M 167.5 78 C 169 74.5 171 73 174 72" strokeWidth={2.4} />
    </g>
  );
}

function Pencil() {
  return (
    <g transform="rotate(-58 104 60)">
      <path d="M 98 55.5 L 134 55.5 L 134 64.5 L 98 64.5 Z" fill="#f2b33d" stroke={INK} strokeWidth={2.8} strokeLinejoin="round" />
      <path d="M 134 55.5 L 139 55.5 L 139 64.5 L 134 64.5 Z" fill="#d9d2c3" stroke={INK} strokeWidth={2.8} strokeLinejoin="round" />
      <path d="M 139 55.5 L 144 55.5 C 147 55.5 148 57.5 148 60 C 148 62.5 147 64.5 144 64.5 L 139 64.5 Z" fill="#e98b7f" stroke={INK} strokeWidth={2.8} strokeLinejoin="round" />
      <path d="M 104 60 L 132 60" stroke="#d6952a" strokeWidth={2} strokeLinecap="round" />
    </g>
  );
}

function ScarfBack({ sw }: { sw: number }) {
  return (
    <g>
      {/* hanging tail */}
      <path
        d="M 92 172 L 122 180 C 121 198 123 214 128 230 L 96 238 C 90 218 89 194 92 172 Z"
        fill="#c8443a"
        stroke={INK}
        strokeWidth={sw}
        strokeLinejoin="round"
      />
      <path d="M 93.5 216 L 125 209" stroke="#f6e3c3" strokeWidth={5} strokeLinecap="butt" />
      <path d="M 95 226 L 127 219" stroke="#f6e3c3" strokeWidth={2.5} strokeLinecap="butt" />
      {/* band around the neck */}
      <path
        d="M 66 118 C 72 146 96 168 134 175 C 160 179 186 174 202 158 C 204 168 203 178 199 186 C 180 200 142 203 112 194 C 84 185 62 160 56 130 C 56 122 60 118 66 118 Z"
        fill="#c8443a"
        stroke={INK}
        strokeWidth={sw}
        strokeLinejoin="round"
      />
      <path d="M 62 140 C 74 164 100 182 136 188 C 160 191 182 188 198 176" fill="none" stroke="#a63128" strokeWidth={3} strokeLinecap="round" opacity={0.7} />
    </g>
  );
}

function ScarfKnot({ sw }: { sw: number }) {
  return (
    <path
      d="M 88 165 C 95 158 116 162 126 170 C 130 178 128 188 122 192 C 110 195 93 191 87 183 C 83 177 84 170 88 165 Z"
      fill="#d85a4e"
      stroke={INK}
      strokeWidth={sw}
      strokeLinejoin="round"
    />
  );
}

function Forelock({ coat, sw }: { coat: Coat; sw: number }) {
  return (
    <path
      d="M 131 55 C 127 47 129 39 136 35 C 136 41 139 45 144 47 C 146 41 152 37 160 38 C 156 43 155 48 157 53"
      fill={coat.fur}
      stroke={INK}
      strokeWidth={sw}
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  );
}

/* ------------------------------------------------------------------ */
/* The figure                                                          */
/* ------------------------------------------------------------------ */

export interface CapyFigureProps {
  who: CapyWho;
  mood?: CapyMood;
  /** Unique prefix for clip path ids. */
  uid: string;
  /** Heavier lines for tiny renders. */
  bold?: boolean;
  /** No thought bubble, sweat drop or blinking (used by avatars). */
  bare?: boolean;
}

/**
 * The drawing itself as SVG group content (240 x 240 units, facing right).
 * Exported so the hot spring scene can place the same art inside its own svg.
 */
export function CapyFigure({ who, mood = "idle", uid, bold = false, bare = false }: CapyFigureProps) {
  const coat = COATS[who];
  const face = FACES[mood];
  const sw = bold ? 5.6 : 4;
  const headClip = `${uid}-head`;
  const bodyClip = `${uid}-body`;
  const blush = who === "biscuit" ? face.blush : face.blush * 0.55;

  // Avatars stay still: a chat full of blinking heads is too much.
  const blinkClass =
    bare || face.eye.closed ? undefined : who === "biscuit" ? `${styles.blink} ${styles.blinkLate}` : styles.blink;

  let extras: ReactNode = null;
  if (!bare && mood === "thinking") extras = <ThoughtDots />;
  if (!bare && mood === "worried") extras = <SweatDrop />;

  return (
    <g>
      <defs>
        <clipPath id={headClip}>
          <path d={HEAD} />
        </clipPath>
        <clipPath id={bodyClip}>
          <path d={BODY} />
        </clipPath>
      </defs>

      {/* body */}
      <path d={BODY} fill={coat.fur} />
      <g clipPath={`url(#${bodyClip})`}>
        <path d={BELLY} fill={coat.light} opacity={0.9} />
        <path d="M 10 276 L 10 246 C 14 206 28 170 52 146 C 40 176 36 210 40 246 L 40 276 Z" fill={coat.shade} opacity={0.55} />
      </g>
      <g fill="none" stroke={coat.shade} strokeWidth={3.2} strokeLinecap="round">
        <path d="M 56 176 l 7 -9" />
        <path d="M 72 190 l 7 -9" />
        <path d="M 50 204 l 7 -9" />
        <path d="M 78 214 l 6 -8" />
      </g>
      <path d={BODY} fill="none" stroke={INK} strokeWidth={sw} strokeLinejoin="round" />

      {who === "biscuit" ? <ScarfBack sw={sw} /> : null}

      {/* far ear sits behind the head */}
      <path d={EAR_FAR} fill={coat.shade} stroke={INK} strokeWidth={sw} strokeLinejoin="round" />

      {/* head */}
      <path d={HEAD} fill={coat.fur} />
      <g clipPath={`url(#${headClip})`}>
        <path d="M 78 104 C 78 134 94 158 126 163 L 76 172 Z" fill={coat.shade} opacity={0.45} />
        <path d={MUZZLE} fill={coat.muzzle} />
        <ellipse cx={166} cy={130} rx={11} ry={6.5} fill={coat.blush} opacity={blush * 0.6} />
        <path d={NOSE} fill={coat.nose} />
        <path d="M 209 66.5 C 216 64 225 65 231 69" fill="none" stroke={coat.noseShine} strokeWidth={2.6} strokeLinecap="round" />
        <ellipse cx={212.5} cy={78.5} rx={4.6} ry={2.7} transform="rotate(24 212.5 78.5)" fill={INK} />
        <ellipse cx={230} cy={79.5} rx={3.4} ry={2.5} transform="rotate(-20 230 79.5)" fill={INK} />
        <g fill={coat.shade}>
          <circle cx={190} cy={114} r={1.7} />
          <circle cx={198} cy={119} r={1.7} />
          <circle cx={188} cy={124} r={1.7} />
        </g>
      </g>
      <path d={HEAD} fill="none" stroke={INK} strokeWidth={sw} strokeLinejoin="round" />

      {who === "barley" ? <Pencil /> : null}

      {/* near ear sits on top */}
      <path d={EAR_NEAR} fill={coat.fur} stroke={INK} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      <path d={EAR_NEAR_INNER} fill={coat.earInner} />

      {who === "biscuit" ? <Forelock coat={coat} sw={sw} /> : null}

      {/* face */}
      {who === "barley" ? <Glasses sw={bold ? 5.6 : 3.6} bold={bold} /> : null}
      <Mouth mood={mood} who={who} sw={sw} />
      <g className={blinkClass}>
        <Eye {...EYE_NEAR} spec={gaze(face.eye, who)} inner={1} sw={sw} />
      </g>
      <g className={blinkClass}>
        <Eye {...EYE_FAR} spec={gaze(face.eyeFar ?? face.eye, who)} inner={-1} sw={sw} />
      </g>
      <Brow cx={EYE_NEAR.cx} cy={who === "barley" ? 65.5 : 72} half={11} spec={temper(face.browNear, who)} inner={1} sw={sw} />
      <Brow cx={EYE_FAR.cx + 1} cy={who === "barley" ? 59.5 : 66} half={8} spec={temper(face.browFar, who)} inner={-1} sw={sw} />
      {who === "barley" ? <GlassesGlint /> : null}
      {who === "biscuit" ? <ScarfKnot sw={sw} /> : null}

      {extras}
    </g>
  );
}

function useUid(): string {
  return `capy${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
}

function Capy({ who, mood = "idle", size = 160, flip = false, className, title }: CapyProps & { who: CapyWho }) {
  const uid = useUid();
  const fallback =
    who === "barley" ? "Barley, the buyer's capybara agent" : "Biscuit, the seller's capybara agent";
  const label = title ?? fallback;
  const a11y = label === "" ? { "aria-hidden": true } : { role: "img", "aria-label": label };
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 240 240"
      width={size}
      height={size}
      className={className}
      focusable="false"
      {...a11y}
    >
      <g transform={flip ? "translate(240 0) scale(-1 1)" : undefined}>
        <CapyFigure who={who} mood={mood} uid={uid} />
      </g>
    </svg>
  );
}

function CapyAvatar({ who, size = 40, className }: CapyAvatarProps & { who: CapyWho }) {
  const uid = useUid();
  const coat = COATS[who];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={`${uid}-round`}>
          <circle cx={50} cy={50} r={48} />
        </clipPath>
      </defs>
      <circle cx={50} cy={50} r={48} fill={coat.avatarBg} />
      <g clipPath={`url(#${uid}-round)`}>
        <g transform={who === "barley" ? "translate(-39.6 -8.2) scale(0.56)" : "translate(-32.2 -11.4) scale(0.52)"}>
          <CapyFigure who={who} mood="idle" uid={uid} bold bare />
        </g>
      </g>
      <circle cx={50} cy={50} r={48} fill="none" stroke={coat.avatarRing} strokeWidth={3} />
    </svg>
  );
}

/** Barley, the buyer's agent: walnut fur, round glasses, pencil behind the ear. */
export function Barley(props: CapyProps) {
  return <Capy who="barley" {...props} />;
}

/** Biscuit, the seller's agent: golden fur, coral scarf. */
export function Biscuit(props: CapyProps) {
  return <Capy who="biscuit" {...props} />;
}

/** Head-only round avatar of Barley for chat bubbles. Decorative. */
export function BarleyAvatar(props: CapyAvatarProps) {
  return <CapyAvatar who="barley" {...props} />;
}

/** Head-only round avatar of Biscuit for chat bubbles. Decorative. */
export function BiscuitAvatar(props: CapyAvatarProps) {
  return <CapyAvatar who="biscuit" {...props} />;
}
