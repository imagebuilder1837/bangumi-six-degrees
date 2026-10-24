import test from "node:test";
import assert from "node:assert/strict";
import { createRandomUsers } from "../src/random-users.mjs";
import { deferred, until } from "./support/async.mjs";

const key = "bangumi-six-degrees:random-range";
const seed = { range: 100, observed: 100, checkedAt: 0 };
function setup({ candidate, relationships, storage, ...options } = {}) {
  const values = new Map(Object.entries(storage ?? {}));
  const commits = [];
  const calls = [];
  const picker = createRandomUsers({
    site: {
      candidate: async (number, options) => {
        calls.push(number);
        return candidate ? candidate(number, options) : null;
      },
      relationships:
        relationships ??
        (async (id) => ({
          snapshot: { status: "available", members: [], fetchedAt: 1 },
          users: [{ id, name: id, avatar: "", fetchedAt: 1 }],
        })),
    },
    store: { commit: async (value) => commits.push(value) },
    storage: () => ({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    }),
    seed,
    now: () => 86400000,
    random: () => 0,
    sleep: async (_, signal) => signal.throwIfAborted(),
    ...options,
  });
  return { picker, values, commits, calls };
}

test("前台超过五位不合格候选后仍继续，合法空列表允许抽中", async () => {
  let draw = 0;
  const env = setup({
    random: () => (++draw - 0.5) / seed.range,
    candidate: (number) =>
      number === 7 ? { id: "seven", name: "[已注销]" } : null,
  });
  const user = await env.picker.pick();
  assert.equal(user.id, "seven");
  assert.deepEqual(
    env.calls.filter((n) => n <= seed.range),
    [1, 2, 3, 4, 5, 6, 7],
  );
  assert.equal(env.commits.length, 2);
});

test("两方向均须正常，排除已填身份后再校验候选", async () => {
  let draw = 0;
  const directions = [];
  const env = setup({
    random: () => (++draw - 0.5) / seed.range,
    candidate: (number) =>
      number <= 3
        ? { id: ["", "filled", "bad", "good"][number], name: "[已注销]" }
        : null,
    relationships: async (id, direction) => {
      directions.push([id, direction]);
      return {
        snapshot:
          id === "bad" && direction === "rev_friends"
            ? { status: "unavailable", fetchedAt: 1 }
            : { status: "available", members: [], fetchedAt: 1 },
        users: [],
      };
    },
  });
  assert.equal(
    (await env.picker.pick({ exclude: () => new Set(["filled"]) })).id,
    "good",
  );
  assert.deepEqual(directions, [
    ["bad", "friends"],
    ["bad", "rev_friends"],
    ["good", "friends"],
    ["good", "rev_friends"],
  ]);
});

test("抽取触发后台范围更新，后续抽取复用范围且短时间不重复探测", async () => {
  const env = setup({
    candidate: (number) => (number <= 200000 ? { id: String(number) } : null),
  });
  assert.equal((await env.picker.pick()).id, "1");
  await until(() => env.values.has(key));
  const saved = JSON.parse(env.values.get(key));
  assert.ok(saved.range >= 200000);
  assert.ok(saved.observed <= 200000);
  assert.ok(saved.range >= saved.observed);
  assert.equal(saved.checkedAt, 86400000);
  const probes = env.calls.filter((n) => n > seed.range);
  assert.equal((await env.picker.pick()).id, "1");
  assert.deepEqual(
    env.calls.filter((n) => n > seed.range),
    probes,
  );
});

test("当前抽取使用缓存范围，不等待后台更新；新范围供后续抽取", async () => {
  const gate = deferred();
  const sampled = [];
  const cached = { range: 200, observed: 190, checkedAt: 86400000 };
  let probing = false;
  const env = setup({
    storage: { [key]: JSON.stringify(cached) },
    random: () => 0.5,
    candidate: async (number) => {
      if (number > cached.range) {
        probing = true;
        await gate.promise;
        return number <= cached.range + 50 ? { id: String(number) } : null;
      }
      sampled.push(number);
      return { id: String(number) };
    },
  });
  assert.equal((await env.picker.pick()).id, "101");
  await until(() => probing);
  assert.equal(env.values.get(key), JSON.stringify(cached));
  gate.resolve();
  await until(() => env.values.get(key) !== JSON.stringify(cached));
  const saved = JSON.parse(env.values.get(key));
  assert.equal(
    (await env.picker.pick()).id,
    String(1 + Math.floor(saved.range * 0.5)),
  );
  assert.deepEqual(sampled, [101, 1 + Math.floor(saved.range * 0.5)]);
});

test("后台暂时故障不改范围，前台网络失败直接结束而非换人", async () => {
  const cached = JSON.stringify({ range: 100, observed: 100, checkedAt: 1 });
  const backgroundFailed = deferred();
  const env = setup({
    storage: { [key]: cached },
    candidate: (number) => {
      if (number > seed.range) backgroundFailed.resolve();
      throw new Error("网络暂时不可用");
    },
  });
  await assert.rejects(env.picker.pick(), /网络暂时不可用/);
  await backgroundFailed.promise;
  assert.equal(env.values.get(key), cached);
  assert.equal(env.calls.filter((n) => n <= seed.range).length, 1);
});

test("无限候选重试可取消，后台取消也不写入部分结果", async () => {
  const abort = new AbortController();
  const gate = deferred();
  const finished = deferred();
  let tries = 0;
  let backgroundSignal;
  const env = setup({
    candidate: async (number, { signal }) => {
      if (number > seed.range) {
        backgroundSignal = signal;
        await gate.promise;
        finished.resolve();
        signal.throwIfAborted();
      }
      return null;
    },
    sleep: async (_, signal) => {
      if (++tries === 9) abort.abort();
      signal.throwIfAborted();
    },
  });
  await assert.rejects(env.picker.pick({ signal: abort.signal }), {
    name: "AbortError",
  });
  assert.equal(tries, 9);
  env.picker.cancel();
  assert.equal(backgroundSignal.aborted, true);
  gate.resolve();
  await finished.promise;
  // Let the rejected probe finish propagating through the background task.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.values.has(key), false);
});

test("排除身份在校验期间改变时，晚到候选也不能与另一端重复", async () => {
  let draw = 0;
  const excluded = new Set();
  const gate = deferred();
  const env = setup({
    random: () => (++draw - 0.5) / seed.range,
    candidate: (number) => (number <= 2 ? { id: String(number) } : null),
    relationships: async (id) => {
      if (id === "1") await gate.promise;
      return {
        snapshot: { status: "available", members: [], fetchedAt: 1 },
        users: [],
      };
    },
  });
  const pending = env.picker.pick({ exclude: () => excluded });
  await until(() => env.calls.includes(1));
  excluded.add("1");
  gate.resolve();
  assert.equal((await pending).id, "2");
});

test("localStorage 被拒绝或损坏不妨碍抽取", async () => {
  for (const storage of [
    () => {
      throw new Error("denied");
    },
    () => ({
      getItem: () => "broken",
      setItem: () => {
        throw new Error("denied");
      },
    }),
  ]) {
    const picker = createRandomUsers({
      site: {
        candidate: async (n) => (n === 1 ? { id: "one" } : null),
        relationships: async () => ({
          snapshot: { status: "available", members: [], fetchedAt: 1 },
          users: [],
        }),
      },
      store: { commit: async () => {} },
      storage,
      seed,
      random: () => 0,
    });
    assert.equal((await picker.pick()).id, "one");
  }
});
