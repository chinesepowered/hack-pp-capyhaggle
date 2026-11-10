"use client";

import { voiceLineUrl, type VoiceLine } from "@/lib/voice-lines";

let queue: Promise<void> = Promise.resolve();

function playOne(line: VoiceLine): Promise<void> {
  return new Promise((resolve) => {
    const audio = new Audio(voiceLineUrl(line));
    audio.volume = 0.9;
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
    // Browsers may refuse audio before the visitor has interacted with the page. That is fine.
    audio.play().catch(() => resolve());
  });
}

/** Plays pre-recorded mascot lines one after another. Never overlaps two lines. */
export function playVoiceLines(lines: VoiceLine[]): void {
  for (const line of lines) queue = queue.then(() => playOne(line));
}
