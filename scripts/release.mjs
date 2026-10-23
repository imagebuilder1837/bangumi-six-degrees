import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function readRelease(root) {
  const manifest = JSON.parse(
    await readFile(resolve(root, "package.json"), "utf8"),
  );
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.version))
    throw new Error("Expected a stable three-part version in package.json");
  const metadata = await readFile(resolve(root, "src/metadata.txt"), "utf8");
  if (
    !metadata.startsWith("// ==UserScript==\n") ||
    !metadata.trimEnd().endsWith("// ==/UserScript==") ||
    !/^\/\/ @version[\t ]+\{\{VERSION\}\}[\t ]*$/m.test(metadata) ||
    (metadata.match(/\{\{VERSION\}\}/g) ?? []).length !== 1 ||
    /\{\{|\}\}/.test(metadata.replace("{{VERSION}}", ""))
  )
    throw new Error("Invalid metadata template");
  for (const field of [
    "name",
    "namespace",
    "version",
    "description",
    "author",
    "license",
    "downloadURL",
    "updateURL",
  ]) {
    if (
      (metadata.match(new RegExp(`^// @${field}[\\t ]+\\S.*$`, "gm")) ?? [])
        .length !== 1
    )
      throw new Error(`Expected one @${field}`);
  }
  const lines = metadata
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "));
  for (const host of ["bgm.tv", "bangumi.tv", "chii.in"])
    for (const direction of ["friends", "rev_friends"])
      if (!lines.includes(`// @match https://${host}/user/*/${direction}`))
        throw new Error(`Missing metadata match for ${host}/${direction}`);
  return { manifest, metadata };
}
