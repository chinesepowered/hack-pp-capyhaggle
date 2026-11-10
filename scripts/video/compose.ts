/**
 * Composes the demo video from the raw footage, the HTML cards and the narration.
 *
 *   pnpm tsx scripts/video/compose.ts
 *
 * For every scene the footage is fitted to the length of its narration (sped up or slowed down),
 * captions naming the PayPal call or the AI at work are overlaid, and the scenes are joined.
 * Output: demo/video.mp4 (1920x1080 H.264 + AAC) and demo/thumb.png (1200x800).
 */
import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { SCENES, type Caption, type Part, type Point, type Scene, type Source } from "./scenes";

const run = promisify(execFile);
const ROOT = process.cwd();
const RAW = path.join(ROOT, "demo", "raw");
const WORK = path.join(RAW, "work");
const CARDS = path.join(ROOT, "demo", "cards");
const FPS = 30;
const LEAD = 0.35;
const TAIL = 0.55;
/** Pause between the narrator and a mascot line, and between two mascot lines. */
const VOICE_GAP = 0.3;
/** Peak levels after gain: the narrator a little above the mascots, both safely under full scale. */
const NARRATOR_PEAK_DB = -2.5;
const MASCOT_PEAK_DB = -5;
const PAPER = "0xfbf5ea";
/**
 * Playwright records a page at its CSS size (1440x810 here) in the top left corner of the
 * 1920x1080 frame and pads the rest. Crop to the page and scale it to fill the frame.
 */
const FILL = "crop=1440:810:0:0,scale=1920:1080:flags=lanczos,setsar=1";

interface Marks {
  main: Record<string, number>;
  popup: Record<string, number>;
  popupViewport?: { width: number; height: number };
}

async function ffmpeg(args: string[]): Promise<void> {
  try {
    await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { maxBuffer: 1 << 26 });
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new Error(`ffmpeg failed: ${(e.stderr ?? e.message).split("\n").slice(-6).join("\n")}\nargs: ${args.join(" ").slice(0, 600)}`);
  }
}

async function duration(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  return parseFloat(stdout.trim());
}

/** Loudest sample and average level of an audio file (or of its last `tail` seconds), in dB. */
async function levels(file: string, tail?: number): Promise<{ peak: number; mean: number }> {
  const args = ["-hide_banner", ...(tail ? ["-sseof", `-${tail}`] : []), "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"];
  const { stderr } = await run("ffmpeg", args, { maxBuffer: 1 << 26 });
  const num = (name: string) => parseFloat(stderr.match(new RegExp(`${name}: (-?[0-9.]+|-inf) dB`))?.[1] ?? "-inf");
  return { peak: num("max_volume"), mean: num("mean_volume") };
}

/** Gain in dB that brings a line's loudest sample to `targetPeak`, so no line can clip in the mix. */
async function gainFor(file: string, targetPeak: number): Promise<number> {
  const { peak } = await levels(file);
  if (!Number.isFinite(peak)) return 0;
  return Math.max(-9, Math.min(9, targetPeak - peak));
}

export interface SpokenLine {
  who: string;
  file: string;
  /** Seconds from the start of the scene. */
  start: number;
  end: number;
}

interface ComposedScene {
  id: string;
  file: string;
  seconds: number;
  lines: SpokenLine[];
}

const at = (marks: Marks, source: Source, [mark, offset = 0]: Point): number => {
  const t = marks[source][mark];
  if (t === undefined) throw new Error(`Mark "${mark}" is missing from ${source} in marks.json.`);
  return Math.max(0, t + offset);
};

const ENC = ["-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p", "-r", String(FPS)];

/** Cuts one piece of footage and normalizes it to 1920x1080 at 30 fps. */
async function cutPart(marks: Marks, part: Part, out: string): Promise<number> {
  const from = at(marks, part.source, part.from);
  const to = at(marks, part.source, part.to);
  const len = Math.max(0.5, to - from);
  const src = path.join(RAW, `${part.source}.webm`);
  let vf = `fps=${FPS},${FILL}`;
  if (part.source === "popup") {
    // PayPal's approval window is smaller than the frame. Crop to it, enlarge it, and set it on paper.
    // Playwright records the popup at its own CSS size in the top left corner of the frame.
    const vp = marks.popupViewport ?? { width: 568, height: 750 };
    const w = Math.min(1920, Math.floor(vp.width / 2) * 2);
    const h = Math.min(1080, Math.floor(vp.height / 2) * 2);
    vf = `fps=${FPS},crop=${w}:${h}:0:0,scale=-2:930:flags=lanczos,pad=iw+12:ih+12:6:6:color=0x2a1f17,pad=1920:1080:(ow-iw)/2:(oh-ih)/2-34:color=${PAPER},setsar=1`;
  }
  await ffmpeg(["-ss", from.toFixed(3), "-t", len.toFixed(3), "-i", src, "-an", "-vf", vf, ...ENC, "-crf", "16", out]);
  return duration(out);
}

/** Records an HTML card (with its CSS animations) as video, at the same size as the app footage. */
async function recordCards(scenes: Scene[]): Promise<void> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const dir = path.join(WORK, "cards");
  await fs.mkdir(dir, { recursive: true });
  for (const scene of scenes) {
    if (!scene.card) continue;
    const context = await browser.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 4 / 3, recordVideo: { dir, size: { width: 1920, height: 1080 } } });
    const page = await context.newPage();
    await page.goto(`file://${path.join(CARDS, scene.card.file)}`);
    await page.waitForTimeout(scene.card.seconds * 1000 + 400);
    const video = page.video();
    await context.close();
    await fs.rename(await video!.path(), path.join(dir, `${scene.id}.webm`));
  }
  // Thumbnail.
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto(`file://${path.join(CARDS, "thumb.html")}`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(ROOT, "demo", "thumb.png") });
  await browser.close();
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Renders every caption as a transparent 1920x1080 PNG. */
async function renderCaptions(scenes: Scene[]): Promise<void> {
  const { chromium } = await import("playwright");
  const dir = path.join(WORK, "captions");
  await fs.mkdir(dir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const scene of scenes) {
    for (const [i, c] of (scene.captions ?? []).entries()) {
      const [tag, ...rest] = c.text.split("  ");
      await page.setContent(`<!doctype html><html><body style="margin:0;width:1920px;height:1080px;background:transparent;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace">
        <div style="position:absolute;left:50%;bottom:34px;transform:translateX(-50%);display:flex;align-items:center;gap:16px;background:rgba(42,31,23,.94);color:#fff;border-radius:18px;padding:14px 24px;font-size:27px;white-space:nowrap;box-shadow:0 6px 24px rgba(0,0,0,.25)">
          <span style="background:#f2b33d;color:#2a1f17;font-weight:800;border-radius:10px;padding:5px 12px;font-family:ui-sans-serif,system-ui,sans-serif;font-size:23px">${esc(tag)}</span>
          ${rest.map((r) => `<span>${esc(r)}</span>`).join('<span style="opacity:.45">|</span>')}
        </div></body></html>`);
      await page.screenshot({ path: path.join(dir, `${scene.id}-${i}.png`), omitBackground: true });
    }
  }
  await browser.close();
}

interface Laid {
  part: Part;
  start: number;
  from: number;
  len: number;
}

/** Where a footage timestamp falls on the scene's own (unfitted) timeline. */
function sceneTime(laid: Laid[], marks: Marks, source: Source, point: Point): number {
  const t = at(marks, source, point);
  const candidates = laid.filter((l) => l.part.source === source);
  let best = candidates[0];
  for (const l of candidates) if (t >= l.from - 0.01) best = l;
  if (!best) return 0;
  return best.start + Math.min(best.len, Math.max(0, t - best.from));
}

async function composeScene(scene: Scene, marks: Marks): Promise<ComposedScene> {
  const dir = path.join(WORK, scene.id);
  await fs.mkdir(dir, { recursive: true });
  const narration = path.join(RAW, "narration", `${scene.id}.mp3`);

  // The audio timeline comes first, because the footage is fitted to it. Lines never overlap:
  // the narrator speaks, then any mascot lines play one after another, then the scene ends.
  const lines: SpokenLine[] = [{ who: "narrator", file: narration, start: LEAD, end: LEAD + (await duration(narration)) }];
  for (const v of scene.voices ?? []) {
    const file = path.join(ROOT, "public", "audio", `${v.file}.mp3`);
    const start = lines[lines.length - 1].end + VOICE_GAP;
    lines.push({ who: v.file.split("-")[0], file, start, end: start + (await duration(file)) });
  }
  const target = lines[lines.length - 1].end + TAIL;

  // 1. Footage: cut the parts (or take the card) and join them.
  const laid: Laid[] = [];
  let rawFile: string;
  if (scene.card) {
    rawFile = path.join(dir, "raw.mp4");
    await ffmpeg(["-ss", "0.25", "-t", String(scene.card.seconds), "-i", path.join(WORK, "cards", `${scene.id}.webm`), "-an", "-vf", `fps=${FPS},${FILL}`, ...ENC, "-crf", "16", rawFile]);
  } else {
    const files: string[] = [];
    let cursor = 0;
    for (const [i, part] of (scene.parts ?? []).entries()) {
      const file = path.join(dir, `part-${i}.mp4`);
      const len = await cutPart(marks, part, file);
      laid.push({ part, start: cursor, from: at(marks, part.source, part.from), len });
      cursor += len;
      files.push(file);
    }
    rawFile = path.join(dir, "raw.mp4");
    if (files.length === 1) await fs.copyFile(files[0], rawFile);
    else {
      const list = path.join(dir, "parts.txt");
      await fs.writeFile(list, files.map((f) => `file '${f}'`).join("\n"));
      await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", rawFile]);
    }
  }
  const rawLen = await duration(rawFile);

  // 2. Fit the footage to the narration. Cards keep their own pace and hold their last frame.
  let speed = scene.card ? 1 : rawLen / target;
  speed = Math.min(8, Math.max(0.8, speed));
  const fitted = rawLen / speed;
  const hold = Math.max(0, target - fitted);
  const filters: string[] = [`[0:v]setpts=PTS/${speed.toFixed(5)},tpad=stop_mode=clone:stop_duration=${(hold + 0.5).toFixed(3)}[base]`];
  const inputs: string[] = ["-i", rawFile];
  let last = "base";
  let index = 1;
  for (const [i, c] of (scene.captions ?? ([] as Caption[])).entries()) {
    const [fromSource, ...fromPoint] = c.from;
    const [toSource, ...toPoint] = c.to;
    const a = sceneTime(laid, marks, fromSource, fromPoint as Point) / speed;
    const b = Math.min(target, sceneTime(laid, marks, toSource, toPoint as Point) / speed);
    if (b - a < 0.6) continue;
    inputs.push("-i", path.join(WORK, "captions", `${scene.id}-${i}.png`));
    filters.push(`[${last}][${index}:v]overlay=0:0:enable='between(t,${a.toFixed(2)},${b.toFixed(2)})'[v${index}]`);
    last = `v${index}`;
    index++;
  }

  // 3. Audio: every line at its place on the timeline, each with a gain that keeps its peak under full scale.
  const audioLabels: string[] = [];
  for (const [i, line] of lines.entries()) {
    inputs.push("-i", line.file);
    const gain = await gainFor(line.file, line.who === "narrator" ? NARRATOR_PEAK_DB : MASCOT_PEAK_DB);
    // Widen the mono line to stereo at unity gain first, so the peak target is what lands in the mix.
    filters.push(`[${index}:a]aresample=44100,pan=stereo|c0=c0|c1=c0,volume=${gain.toFixed(2)}dB,adelay=${Math.round(line.start * 1000)}:all=1[a${i}]`);
    audioLabels.push(`[a${i}]`);
    index++;
  }
  filters.push(`${audioLabels.join("")}amix=inputs=${audioLabels.length}:normalize=0:duration=longest,apad[aout]`);

  const out = path.join(WORK, `${scene.id}.mp4`);
  await ffmpeg([
    ...inputs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    `[${last}]`,
    "-map",
    "[aout]",
    "-t",
    target.toFixed(3),
    ...ENC,
    "-crf",
    "21",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-ar",
    "44100",
    "-ac",
    "2",
    out,
  ]);
  console.log(`${scene.id}: footage ${rawLen.toFixed(1)}s at ${speed.toFixed(2)}x, scene ${target.toFixed(1)}s`);
  return { id: scene.id, file: out, seconds: target, lines };
}

/**
 * Checks that no spoken line is cut off, talked over, or distorted:
 *  - on the planned timeline, lines do not overlap and each ends before its scene does,
 *  - each source file ends in quiet (the speech was not truncated when it was generated),
 *  - in the finished video, every scene boundary falls in silence,
 *  - the loudest sample of the finished video is under full scale.
 */
async function verifyAudio(scenes: ComposedScene[], video: string): Promise<string[]> {
  const problems: string[] = [];
  const boundaries: number[] = [];
  let offset = 0;
  console.log("\nAudio timeline (seconds into the video):");
  for (const scene of scenes) {
    for (const [i, line] of scene.lines.entries()) {
      const next = scene.lines[i + 1];
      if (next && next.start < line.end + 0.1) problems.push(`${scene.id}: ${line.who} and ${next.who} overlap`);
      if (line.end > scene.seconds - 0.25) problems.push(`${scene.id}: ${line.who} runs into the end of the scene`);
      const whole = await levels(line.file);
      const tail = await levels(line.file, 0.06);
      // Speech that was cut mid-word ends about as loud as it was. A finished line trails off.
      if (Number.isFinite(tail.mean) && tail.mean > whole.mean - 6) problems.push(`${scene.id}: ${line.who} audio file ends abruptly (tail ${tail.mean} dB, average ${whole.mean} dB)`);
      console.log(`  ${(offset + line.start).toFixed(2).padStart(7)} to ${(offset + line.end).toFixed(2).padStart(7)}  ${line.who.padEnd(8)} ${scene.id}  (file tail ${tail.mean} dB, average ${whole.mean} dB)`);
    }
    offset += scene.seconds;
    boundaries.push(offset);
  }
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-i", video, "-vn", "-af", "silencedetect=noise=-40dB:d=0.12", "-f", "null", "-"], { maxBuffer: 1 << 26 });
  const starts = [...stderr.matchAll(/silence_start: (-?[0-9.]+)/g)].map((m) => parseFloat(m[1]));
  const ends = [...stderr.matchAll(/silence_end: (-?[0-9.]+)/g)].map((m) => parseFloat(m[1]));
  const total = await duration(video);
  const silent = (t: number) => starts.some((start, i) => t >= start - 0.02 && t <= (ends[i] ?? total) + 0.02);
  for (const [i, b] of boundaries.slice(0, -1).entries()) {
    if (!silent(b - 0.06) || !silent(Math.min(total, b + 0.06))) problems.push(`sound is still playing at the cut after ${scenes[i].id} (${b.toFixed(2)}s)`);
  }
  if (!silent(total - 0.08)) problems.push("sound is still playing at the very end of the video");
  const final = await levels(video);
  console.log(`Loudest sample ${final.peak} dB, average ${final.mean} dB. Cuts between scenes checked for silence: ${boundaries.length - 1}.`);
  if (final.peak > -1) problems.push(`the mix peaks at ${final.peak} dB, too close to full scale`);
  return problems;
}

async function main() {
  if (!existsSync(path.join(RAW, "marks.json"))) throw new Error("demo/raw/marks.json is missing. Run scripts/video/record.ts first.");
  const stored = JSON.parse(await fs.readFile(path.join(RAW, "marks.json"), "utf8")) as Marks;
  const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  await fs.mkdir(WORK, { recursive: true });
  if (!process.argv.includes("--skip-cards")) await recordCards(SCENES);
  await renderCaptions(SCENES);

  if (only.length) console.log("Note: every scene is composed again so the audio check covers the whole video.");
  const done: ComposedScene[] = [];
  for (const scene of SCENES) done.push(await composeScene(scene, stored));

  const list = path.join(WORK, "scenes.txt");
  await fs.writeFile(list, done.map((d) => `file '${d.file}'`).join("\n"));
  const out = path.join(ROOT, "demo", "video.mp4");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out]);
  const total = await duration(out);
  const size = (await fs.stat(out)).size / (1024 * 1024);
  console.log(`\ndemo/video.mp4: ${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, "0")} (${total.toFixed(1)}s), ${size.toFixed(1)} MB`);
  const problems = await verifyAudio(done, out);
  if (total >= 180) problems.push("the video is 3 minutes or longer");
  if (size >= 50) problems.push("the video is 50 MB or larger");
  await fs.writeFile(
    path.join(WORK, "timeline.json"),
    JSON.stringify({ seconds: total, scenes: done.map((d) => ({ id: d.id, seconds: d.seconds, lines: d.lines.map((l) => ({ who: l.who, start: l.start, end: l.end })) })) }, null, 2),
  );
  if (problems.length) {
    console.error(`\nPROBLEMS:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    process.exit(1);
  }
  console.log("Audio check passed: no line overlaps another, none is cut off, and the mix does not clip.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
