import test from "node:test";
import assert from "node:assert/strict";
import { search } from "../src/search.mjs";
import { graphSource, shortestLength } from "./support/graphs.mjs";

test("排除两跳中转后，三种模式均寻找允许的更长最短路径", async () => {
  const edges = {
    a: ["hub", "b"],
    hub: ["a", "z"],
    b: ["a", "c"],
    c: ["b", "z"],
    z: ["hub", "c"],
  };
  for (const mode of ["directed", "undirected", "mutual"]) {
    const result = await search({
      start: "a",
      end: "z",
      mode,
      excluded: ["hub"],
      source: graphSource(edges),
    });
    assert.deepEqual(result.path, ["a", "b", "c", "z"]);
  }
});

test("名单中的端点仍允许零跳和一跳，缺失证据不误报不可达", async () => {
  for (const mode of ["directed", "undirected", "mutual"]) {
    const options = {
      mode,
      excluded: ["a", "z"],
      source: graphSource({ a: ["z"], z: ["a"] }),
    };
    assert.deepEqual(
      (await search({ ...options, start: "a", end: "a" })).path,
      ["a"],
    );
    assert.deepEqual(
      (await search({ ...options, start: "a", end: "z" })).path,
      ["a", "z"],
    );
  }
  const result = await search({
    start: "a",
    end: "z",
    excluded: ["hub"],
    source: { load: async () => [] },
  });
  assert.equal(result.status, "incomplete");
});

test("方向补证触发重证时仍排除中转，不重新引入被排除的两跳路径", async () => {
  const lists = {
    a: { friends: ["hub", "b", "d"], rev_friends: [] },
    b: { friends: ["a"], rev_friends: ["a"] },
    d: { friends: ["e"], rev_friends: ["a"] },
    e: { friends: ["z"], rev_friends: ["d"] },
    z: { friends: [], rev_friends: ["hub", "b", "e"] },
  };
  const result = await search({
    start: "a",
    end: "z",
    mode: "directed",
    excluded: ["hub"],
    source: {
      load: async (keys) =>
        keys.map(([id, direction]) => ({
          id,
          direction,
          snapshot: { status: "available", members: lists[id][direction] },
        })),
    },
  });
  assert.deepEqual(result.path, ["a", "d", "e", "z"]);
  assert.deepEqual(
    result.relations,
    Array.from({ length: 3 }, () => ({ forward: true, reverse: false })),
  );
});

test("排除任意中转及端点时，三模式的不均衡搜索与独立受限图穷举一致", async () => {
  let seed = 47;
  const random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let sample = 0; sample < 80; sample++) {
    const ids = ["a", "b", "c", "d", "z"];
    const edges = Object.fromEntries(
      ids.map((id) => [id, ids.filter(() => random() < 0.3)]),
    );
    const excluded = ids.filter(() => random() < 0.5);
    const allowed = ids.filter(
      (id) => id === "a" || id === "z" || !excluded.includes(id),
    );
    const restricted = Object.fromEntries(
      allowed.map((id) => [
        id,
        edges[id].filter((other) => allowed.includes(other)),
      ]),
    );
    for (const mode of ["directed", "undirected", "mutual"]) {
      const source = graphSource(edges);
      source.estimate = async (keys) =>
        keys.reduce((sum, [id]) => sum + (id === "a" ? 100 : 1), 0);
      const result = await search({
        start: "a",
        end: "z",
        mode,
        excluded,
        source,
      });
      const expected = shortestLength(restricted, "a", "z", mode);
      assert.equal(result.path ? result.path.length - 1 : Infinity, expected);
      assert.equal(
        result.status,
        expected === Infinity ? "unreachable" : "found",
      );
      assert.ok(
        result.path?.slice(1, -1).every((id) => !excluded.includes(id)) ?? true,
      );
    }
  }
});
