/**
 * Pre-renders the mascots' voice lines into public/audio with ElevenLabs.
 * Lines that already exist are skipped, so re-running costs nothing.
 *
 *   pnpm tsx scripts/voice-lines.ts [--force] [--agent barley|biscuit]
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { VOICE_LINES } from "../lib/voice-lines";
import { readUsage, speak } from "./lib/elevenlabs";
import { loadEnv } from "./lib/env";

loadEnv();

async function main() {
  const force = process.argv.includes("--force");
  // --agent biscuit re-renders only that mascot's lines (used when its voice changes).
  const agentFlag = process.argv.indexOf("--agent");
  const onlyAgent = agentFlag > 0 ? process.argv[agentFlag + 1] : undefined;
  for (const [name, line] of Object.entries(VOICE_LINES)) {
    const outFile = path.join(process.cwd(), "public", "audio", `${name}.mp3`);
    if (existsSync(outFile) && !force && line.agent !== onlyAgent) {
      console.log(`skip ${name} (exists)`);
      continue;
    }
    await speak({ text: line.text, voice: line.agent, outFile, stability: 0.45, style: 0.35 });
    console.log(`made ${name}: "${line.text}"`);
  }
  const usage = await readUsage();
  console.log(`ElevenLabs characters used so far: ${usage.totalCharacters} of ${usage.budget}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
