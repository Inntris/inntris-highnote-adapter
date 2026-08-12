import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(".");
const excludedDirectories = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  "evidence-output",
]);
const excludedExtensions = new Set([".zip", ".png", ".jpg", ".jpeg", ".gif", ".ico"]);
const patterns: Array<{ name: string; pattern: RegExp }> = [
  { name: "private key block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u },
  { name: "GitHub token", pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/u },
  { name: "live payment key", pattern: /\bsk_live_[A-Za-z0-9]{16,}\b/u },
  {
    name: "populated Inntris signing seed",
    pattern: /INNTRIS_SIGNING_SEED_BASE64URL=(?!replace-with-)[A-Za-z0-9_-]{40,}/u,
  },
  {
    name: "populated Highnote endpoint secret",
    pattern: /HIGHNOTE_SIGNING_SECRETS=(?!replace-with-)[^\s#]{16,}/u,
  },
];

async function filesIn(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesIn(entryPath)));
    else if (entry.isFile() && !excludedExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(entryPath);
    }
  }
  return files;
}

const findings: string[] = [];
for (const file of await filesIn(root)) {
  if (path.resolve(file) === path.resolve(import.meta.dirname, "scan-secrets.ts")) continue;
  const contents = await readFile(file, "utf8");
  for (const candidate of patterns) {
    if (candidate.pattern.test(contents)) {
      findings.push(`${path.relative(root, file)}: ${candidate.name}`);
    }
  }
}
if (findings.length > 0) {
  process.stderr.write(`Potential secret material detected:\n${findings.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("No configured secret pattern detected.\n");
}
