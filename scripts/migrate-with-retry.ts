import { spawnSync } from "node:child_process";

const MAX_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [0, 5000, 10000, 20000];

export function isRetryableMigrationLockError(output: string) {
  return /\bP1002\b/u.test(output) && /advisory lock/iu.test(output);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (RETRY_DELAYS_MS[attempt - 1] > 0) {
      const delay = RETRY_DELAYS_MS[attempt - 1];
      console.log(`Migration lock is busy. Retrying in ${Math.round(delay / 1000)}s (attempt ${attempt}/${MAX_ATTEMPTS})...`);
      await sleep(delay);
    }

    const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
      encoding: "utf8",
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"]
    });

    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);

    if (result.status === 0) return;

    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const retryable = isRetryableMigrationLockError(output);
    if (!retryable || attempt === MAX_ATTEMPTS) {
      process.exit(result.status ?? 1);
    }
  }
}

void main();
