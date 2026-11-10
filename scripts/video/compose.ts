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
const PAPER = "0xfbf5ea";

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
  let vf = `fps=${FPS},scale=1920:1080:flags=lanczos,setsar=1`;
  if (part.source === "popup") {
    // PayPal's approval window is smaller than the frame. Crop to it, enlarge it, and set it on paper.
    const vp = marks.popupViewport ?? { width: 500, height: 646 };
    const w = Math.min(1920, Math.round((vp.width * 4) / 3 / 2) * 2);
    const h = Math.min(1080, Math.round((vp.height * 4) / 3 / 2) * 2);
    vf = `fps=${FPS},crop=${w}:${h}:0:0,scale=-2:960:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=${PAPER},setsar=1`;
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

async function composeScene(scene: Scene, marks: Marks): Promise<{ file: string; seconds: number }> {
  const dir = path.join(WORK, scene.id);
  await fs.mkdir(dir, { recursive: true });
  const narration = path.join(RAW, "narration", `${scene.id}.mp3`);
  const target = (await duration(narration)) + LEAD + TAIL;

  // 1. Footage: cut the parts (or take the card) and join them.
  const laid: Laid[] = [];
  let rawFile: string;
  if (scene.card) {
    rawFile = path.join(dir, "raw.mp4");
    await ffmpeg(["-ss", "0.25", "-t", String(scene.card.seconds), "-i", path.join(WORK, "cards", `${scene.id}.webm`), "-an", "-vf", `fps=${FPS},scale=1920:1080:flags=lanczos,setsar=1`, ...ENC, "-crf", "16", rawFile]);
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

  // 3. Audio: the narration, plus any pre-rendered mascot lines near the end of the scene.
  inputs.push("-i", narration);
  const audioLabels: string[] = [];
  filters.push(`[${index}:a]adelay=${Math.round(LEAD * 1000)}:all=1,aresample=44100[a0]`);
  audioLabels.push("[a0]");
  index++;
  for (const [i, v] of (scene.voices ?? []).entries()) {
    inputs.push("-i", path.join(ROOT, "public", "audio", `${v.file}.mp3`));
    const when = Math.max(0, target - v.beforeEnd);
    filters.push(`[${index}:a]adelay=${Math.round(when * 1000)}:all=1,volume=0.75,aresample=44100[m${i}]`);
    audioLabels.push(`[m${i}]`);
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
  return { file: out, seconds: target };
}

async function main() {
  if (!existsSync(path.join(RAW, "marks.json"))) throw new Error("demo/raw/marks.json is missing. Run scripts/video/record.ts first.");
  const stored = JSON.parse(await fs.readFile(path.join(RAW, "marks.json"), "utf8")) as Marks;
  const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  await fs.mkdir(WORK, { recursive: true });
  if (!process.argv.includes("--skip-cards")) await recordCards(SCENES);
  await renderCaptions(SCENES);

  const done: { file: string; seconds: number }[] = [];
  for (const scene of SCENES) {
    const out = path.join(WORK, `${scene.id}.mp4`);
    if (only.length && !only.includes(scene.id) && existsSync(out)) {
      done.push({ file: out, seconds: await duration(out) });
      continue;
    }
    done.push(await composeScene(scene, stored));
  }

  const list = path.join(WORK, "scenes.txt");
  await fs.writeFile(list, done.map((d) => `file '${d.file}'`).join("\n"));
  const out = path.join(ROOT, "demo", "video.mp4");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out]);
  const total = await duration(out);
  const size = (await fs.stat(out)).size / (1024 * 1024);
  console.log(`\ndemo/video.mp4: ${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, "0")} (${total.toFixed(1)}s), ${size.toFixed(1)} MB`);
  if (total >= 180) console.warn("WARNING: the video is 3 minutes or longer.");
  if (size >= 50) console.warn("WARNING: the video is 50 MB or larger.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
