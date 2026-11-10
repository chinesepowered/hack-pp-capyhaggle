/**
 * ElevenLabs text to speech for build-time assets only: the mascots' voice lines in public/audio
 * and the demo video narration. The hosted app never calls ElevenLabs.
 * Every request is added to demo/elevenlabs-usage.json so the character budget stays visible.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export const VOICES = {
  /** Narrator for the demo video (Brian). */
  narrator: "nPczCjzI2devNBz1zQrb",
  /** Barley: Callum, a husky character voice. */
  barley: "N2lVS1w4EtoT3dr4eOWO",
  /** Biscuit: Jessica, playful and warm. */
  biscuit: "cgSgspJ2msm6clMCkdW9",
} as const;

const USAGE_FILE = path.join(process.cwd(), "demo", "elevenlabs-usage.json");

interface Usage {
  totalCharacters: number;
  budget: number;
  requests: { at: string; voice: string; characters: number; file: string }[];
}

export async function readUsage(): Promise<Usage> {
  try {
    return JSON.parse(await fs.readFile(USAGE_FILE, "utf8")) as Usage;
  } catch {
    return { totalCharacters: 0, budget: 15000, requests: [] };
  }
}

export async function speak(opts: { text: string; voice: keyof typeof VOICES; outFile: string; stability?: number; style?: number; speed?: number }): Promise<void> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set.");
  const usage = await readUsage();
  if (usage.totalCharacters + opts.text.length > usage.budget) {
    throw new Error(`ElevenLabs budget would be exceeded: ${usage.totalCharacters} used + ${opts.text.length} > ${usage.budget}.`);
  }
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICES[opts.voice]}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text: opts.text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: opts.stability ?? 0.5, similarity_boost: 0.75, style: opts.style ?? 0.2, use_speaker_boost: true, speed: opts.speed ?? 1 },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  await fs.mkdir(path.dirname(opts.outFile), { recursive: true });
  await fs.writeFile(opts.outFile, Buffer.from(await res.arrayBuffer()));
  usage.totalCharacters += opts.text.length;
  usage.requests.push({ at: new Date().toISOString(), voice: opts.voice, characters: opts.text.length, file: path.relative(process.cwd(), opts.outFile) });
  await fs.mkdir(path.dirname(USAGE_FILE), { recursive: true });
  await fs.writeFile(USAGE_FILE, JSON.stringify(usage, null, 2) + "\n", "utf8");
}
