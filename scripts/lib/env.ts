/** Loads .env.local (then .env) for scripts. Never prints values. */
import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";

export function loadEnv(): void {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(process.cwd(), name);
    if (fs.existsSync(file)) config({ path: file, quiet: true });
  }
}

export function requireEnv(names: string[]): void {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    console.error(`Missing environment variables: ${missing.join(", ")}. Copy .env.example to .env.local and fill them in.`);
    process.exit(1);
  }
}
