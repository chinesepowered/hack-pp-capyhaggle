/**
 * Narrates the demo video with ElevenLabs (narrator voice, model eleven_multilingual_v2).
 * One file per scene in demo/raw/narration. A scene is only re-spoken when its text changed.
 * Also writes demo/narration.txt.
 *
 *   pnpm tsx scripts/video/narrate.ts
 */
import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { readUsage, speak } from "../lib/elevenlabs";
import { loadEnv } from "../lib/env";
import { NARRATION_TEXT, SCENES } from "./scenes";

loadEnv();

async function main() {
  const dir = path.join(process.cwd(), "demo", "raw", "narration");
  await fs.mkdir(dir, { recursive: true });
  const hashFile = path.join(dir, "hashes.json");
  let hashes: Record<string, string> = {};
  try {
    hashes = JSON.parse(await fs.readFile(hashFile, "utf8")) as Record<string, string>;
  } catch {
    // first run
  }
  for (const scene of SCENES) {
    const hash = createHash("sha256").update(scene.narration).digest("hex").slice(0, 16);
    const outFile = path.join(dir, `${scene.id}.mp3`);
    if (existsSync(outFile) && hashes[scene.id] === hash) {
      console.log(`skip ${scene.id}`);
      continue;
    }
    await speak({ text: scene.narration, voice: "narrator", outFile, stability: 0.55, style: 0.15, speed: 1.04 });
    hashes[scene.id] = hash;
    await fs.writeFile(hashFile, JSON.stringify(hashes, null, 2));
    console.log(`spoke ${scene.id} (${scene.narration.length} characters)`);
  }
  await fs.writeFile(path.join(process.cwd(), "demo", "narration.txt"), `Capy vs Capy: demo video narration\n\n${NARRATION_TEXT}\n`, "utf8");
  const usage = await readUsage();
  console.log(`ElevenLabs characters used so far: ${usage.totalCharacters} of ${usage.budget}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
