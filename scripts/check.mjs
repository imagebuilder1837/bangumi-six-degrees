import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { check } from "prettier";
import { generateArtifact } from "./build.mjs";
import { readRelease } from "./release.mjs";

const root = process.cwd();
async function modules(directory) {
  const files = [];
  for (const entry of await readdir(resolve(root, directory), {
    withFileTypes: true,
  })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await modules(path)));
    else if (entry.name.endsWith(".mjs")) files.push(path);
  }
  return files.sort();
}
const files = [
  "src/index.user.js",
  ...(await modules("src")),
  ...(await modules("scripts")),
  ...(await modules("test")),
];
for (const file of files) {
  if (
    !(await check(await readFile(resolve(root, file), "utf8"), {
      filepath: file,
    }))
  )
    throw new Error(`Prettier failed: ${file}`);
  execFileSync(process.execPath, ["--check", file], {
    cwd: root,
    stdio: "inherit",
  });
}
console.log("Formatting and syntax passed");
const { manifest } = await readRelease(root);
const lock = JSON.parse(
  await readFile(resolve(root, "package-lock.json"), "utf8"),
);
for (const value of [lock, lock.packages?.[""]])
  if (value?.version !== manifest.version || value?.name !== manifest.name)
    throw new Error("Lockfile identity differs from package.json");
for (const field of ["dependencies", "devDependencies"])
  if (!isDeepStrictEqual(manifest[field] ?? {}, lock.packages[""][field] ?? {}))
    throw new Error(`Lockfile ${field} differ from package.json`);
if (
  (await readFile(resolve(root, "src/index.user.js"), "utf8")) !==
  (await generateArtifact(root))
)
  throw new Error("Artifact is stale; run npm run build");
console.log("Release and reproducible artifact passed");
const tests = (await readdir(resolve(root, "test")))
  .filter((file) => file.endsWith(".test.mjs"))
  .sort();
if (!tests.length) throw new Error("No tests found");
execFileSync(
  process.execPath,
  ["--test", ...tests.map((file) => `test/${file}`)],
  { cwd: root, stdio: "inherit" },
);
