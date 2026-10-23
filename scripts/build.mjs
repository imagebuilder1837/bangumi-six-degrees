import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { rollup } from "rollup";
import { format } from "prettier";
import { readRelease } from "./release.mjs";

export async function generateArtifact(root) {
  const { manifest, metadata } = await readRelease(root);
  const bundle = await rollup({ input: resolve(root, "src/main.mjs") });
  try {
    const { output } = await bundle.generate({ format: "iife" });
    return await format(
      `${metadata.trimEnd().replace("{{VERSION}}", manifest.version)}\n\n// Generated from src/main.mjs and its imports, including vendor modules. Do not edit; run npm run build.\n${output[0].code}`,
      { parser: "babel" },
    );
  } finally {
    await bundle.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await writeFile(
    resolve("src/index.user.js"),
    await generateArtifact(process.cwd()),
  );
}
