import test from "node:test";
import assert from "node:assert/strict";
import { search } from "../src/search.mjs";
import { graphSource as source, shortestLength } from "./support/graphs.mjs";

test("三种关系模式在不均衡扩展下与穷举简单路径的最短长度一致", async () => {
  let seed = 19;
  const random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let sample = 0; sample < 100; sample++) {
    const ids = ["a", "b", "c", "d", "e", "z"];
    const edges = Object.fromEntries(
      ids.map((id) => [id, ids.filter(() => random() < 0.25)]),
    );
    for (const mode of ["directed", "undirected", "mutual"]) {
      const provider = source(edges);
      provider.estimate = async (keys) =>
        keys.reduce(
          (sum, [id, direction]) =>
            sum +
            ((id.charCodeAt(0) % 4) + 1) * (direction === "friends" ? 2 : 1),
          0,
        );
      const result = await search({
        start: "a",
        end: "z",
        mode,
        source: provider,
      });
      const expected = shortestLength(edges, "a", "z", mode);
      assert.equal(
        result.path ? result.path.length - 1 : Infinity,
        expected,
        JSON.stringify({ edges, mode }),
      );
      if (result.path) {
        assert.deepEqual(
          result.relations,
          result.path.slice(1).map((id, index) => ({
            forward: edges[result.path[index]].includes(id),
            reverse: edges[id].includes(result.path[index]),
          })),
        );
      }
    }
  }
});

test("同一用户是零跳，六跳以上仍然返回路径", async () => {
  assert.deepEqual(
    await search({
      start: "a",
      end: "a",
      source: {
        async load() {
          throw new Error("零跳不应读取关系列表");
        },
      },
    }),
    { status: "found", path: ["a"], relations: [] },
  );
  const edges = Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [
      String(i),
      i < 7 ? [String(i + 1)] : [],
    ]),
  );
  assert.equal(
    (await search({ start: "0", end: "7", source: source(edges) })).path.length,
    8,
  );
});

test("已识别原站错误排除无效节点，普通缺失条目不抹掉其他有效关系", async () => {
  const provider = source({ a: ["bad", "c"], bad: ["z"], c: ["z"], z: [] });
  const original = provider.load;
  provider.estimate = async (keys) =>
    keys.some(([, direction]) => direction === "rev_friends")
      ? 1000
      : keys.length;
  provider.load = async (keys) =>
    (await original(keys)).map((record) =>
      record.id === "bad"
        ? {
            ...record,
            snapshot: {
              status: "unavailable",
              fetchedAt: 2,
              issue: { code: "deleted-display-name-page-unavailable" },
            },
          }
        : record,
    );
  assert.deepEqual(
    (await search({ start: "a", end: "z", source: provider })).path,
    ["a", "c", "z"],
  );
});

test("缺少必要观察不是空列表，另一侧的完整证据仍可证明最短", async () => {
  const partial = {
    async load(keys) {
      return keys
        .filter(([, direction]) => direction === "friends")
        .map(([id, direction]) => ({
          id,
          direction,
          snapshot: {
            status: "available",
            fetchedAt: 1,
            members: { a: ["b"], b: ["z"] }[id] ?? [],
          },
        }));
    },
  };
  assert.deepEqual(
    (await search({ start: "a", end: "z", source: partial })).path,
    ["a", "b", "z"],
  );
  assert.equal(
    (
      await search({
        start: "a",
        end: "z",
        source: {
          async load() {
            return [];
          },
        },
      })
    ).status,
    "incomplete",
  );
});

test("单向好友返回最短路径而不是先遇到的长路径", async () => {
  const result = await search({
    start: "a",
    end: "z",
    mode: "directed",
    source: source({
      a: ["b", "c"],
      b: ["d"],
      d: ["e"],
      e: ["z"],
      c: ["z"],
      z: [],
    }),
  });
  assert.deepEqual(result.path, ["a", "c", "z"]);
});

test("较新的反方向观察删除已走过的边，不能沿用旧的最短性证明", async () => {
  const data = {
    a: { friends: [1, ["b", "c"]], rev_friends: [1, []] },
    z: { friends: [1, []], rev_friends: [1, ["d", "e"]] },
    b: { friends: [3, ["z"]], rev_friends: [3, []] },
    c: { friends: [3, []], rev_friends: [3, []] },
  };
  const provider = {
    async load(keys) {
      return keys.map(([id, direction]) => {
        const [fetchedAt, members] = data[id]?.[direction] ?? [1, []];
        return {
          id,
          direction,
          snapshot: { status: "available", fetchedAt, members },
        };
      });
    },
  };
  assert.equal(
    (
      await search({
        start: "a",
        end: "z",
        mode: "undirected",
        source: provider,
      })
    ).status,
    "unreachable",
  );
});

test("局部重证保留有效支路，网络按后到观察而非缓存时间仲裁且不重复请求", async () => {
  const data = {
    a: { friends: [99, ["b", "c"]], rev_friends: [99, []] },
    z: { friends: [99, []], rev_friends: [99, ["d", "e"]] },
    b: { friends: [1, ["z"]], rev_friends: [1, []] },
    c: { friends: [1, ["w"]], rev_friends: [1, ["a"]] },
    w: { friends: [1, ["z"]], rev_friends: [1, ["c"]] },
  };
  const loaded = new Set();
  const provider = {
    async load(keys) {
      return keys.map(([id, direction]) => {
        const key = JSON.stringify([id, direction]);
        assert.equal(loaded.has(key), false, `不应重抓 ${key}`);
        loaded.add(key);
        const [fetchedAt, members] = data[id]?.[direction] ?? [1, []];
        return {
          id,
          direction,
          snapshot: { status: "available", fetchedAt, members },
        };
      });
    },
  };
  assert.deepEqual(
    (
      await search({
        start: "a",
        end: "z",
        mode: "undirected",
        source: provider,
      })
    ).path,
    ["a", "c", "w", "z"],
  );
});

test("补查方向推翻旧路径时重证换路，复用本轮已取列表", async () => {
  const lists = {
    a: { friends: ["b", "d"], rev_friends: [] },
    b: { friends: ["a"], rev_friends: ["a"] },
    d: { friends: ["e"], rev_friends: ["a"] },
    e: { friends: ["z"], rev_friends: ["d"] },
    z: { friends: [], rev_friends: ["b", "e"] },
  };
  const loaded = new Set();
  const result = await search({
    start: "a",
    end: "z",
    mode: "directed",
    source: {
      async load(keys) {
        return keys.map(([id, direction]) => {
          const key = JSON.stringify([id, direction]);
          assert.equal(loaded.has(key), false, `不应重抓 ${key}`);
          loaded.add(key);
          return {
            id,
            direction,
            snapshot: { status: "available", members: lists[id][direction] },
          };
        });
      },
    },
  });
  assert.deepEqual(result.path, ["a", "d", "e", "z"]);
  assert.deepEqual(result.relations, [
    { forward: true, reverse: false },
    { forward: true, reverse: false },
    { forward: true, reverse: false },
  ]);
});

test("缺少反方向观察时不把未知当作不存在，不发布最终路径", async () => {
  const result = await search({
    start: "a",
    end: "z",
    source: {
      async load(keys) {
        return keys
          .filter(([id, direction]) => id === "a" && direction === "friends")
          .map(([id, direction]) => ({
            id,
            direction,
            snapshot: { status: "available", members: ["z"] },
          }));
      },
    },
  });
  assert.deepEqual(result, { status: "incomplete" });
});

test("单向好友补齐反方向后才返回互相添加的最终路径", async () => {
  const result = await search({
    start: "a",
    end: "z",
    mode: "directed",
    source: source({ a: ["z"], z: ["a"] }),
  });
  assert.deepEqual(result.path, ["a", "z"]);
  assert.deepEqual(result.relations, [{ forward: true, reverse: true }]);
});

test("无向关联的最终路径逐段说明实际好友方向", async () => {
  const result = await search({
    start: "a",
    end: "z",
    mode: "undirected",
    source: source({ a: ["b"], b: ["a", "c"], c: [], z: ["c"] }),
  });
  assert.deepEqual(result.path, ["a", "b", "c", "z"]);
  assert.deepEqual(result.relations, [
    { forward: true, reverse: true },
    { forward: true, reverse: false },
    { forward: false, reverse: true },
  ]);
});

test("无向关联可逆行，双向好友仅通过互相添加的边", async () => {
  const graph = { a: ["b"], b: ["a", "z"], z: ["b"], x: ["a"] };
  assert.deepEqual(
    (
      await search({
        start: "a",
        end: "x",
        mode: "undirected",
        source: source(graph),
      })
    ).path,
    ["a", "x"],
  );
  assert.deepEqual(
    (
      await search({
        start: "a",
        end: "z",
        mode: "mutual",
        source: source(graph),
      })
    ).path,
    ["a", "b", "z"],
  );
  assert.equal(
    (
      await search({
        start: "a",
        end: "x",
        mode: "mutual",
        source: source(graph),
      })
    ).status,
    "unreachable",
  );
});
