import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { createRelationshipStore } from "../vendor/bangumi-relationship-store/src/index.mjs";
import { createDataSource } from "../src/data.mjs";
import { createSite } from "../src/site.mjs";
import { createRequests } from "../src/requests.mjs";
import { search } from "../src/search.mjs";
import { browser } from "./support/browser.mjs";
import { deferred, until } from "./support/async.mjs";

test("网络取数不复用旧关系，运行内去重并提交扫描资料", async () => {
  const store = createRelationshipStore({ indexedDB: new IDBFactory() });
  await store.commit({
    relationships: {
      alice: {
        friends: { status: "available", members: ["old"], fetchedAt: 1 },
      },
    },
  });
  const env = browser({ profiles: { bob: { name: "新昵称" } } });
  const site = createSite({
    window: env.window,
    requests: createRequests({ fetch: env.fetch }),
  });
  const live = createDataSource({ store, site });
  const records = await live.load([["alice", "friends"]]);
  assert.deepEqual(records[0].snapshot.members, ["bob"]);
  assert.equal((await live.users(["bob"])).get("bob").name, "新昵称");
  await live.load([["alice", "friends"]]);
  assert.equal(env.urls.length, 1);
  const saved = await store.read({
    relationships: [["alice", "friends"]],
    users: ["bob"],
  });
  assert.deepEqual(saved.relationships.alice.friends.members, ["bob"]);
  assert.equal(saved.users.bob.avatar, "https://lain.bgm.tv/bob.jpg");
  const next = createDataSource({ store, site });
  await next.load([["alice", "friends"]]);
  assert.equal(env.urls.length, 2);
  env.window.close();
});

test("存储不可用不阻止网络取数", async () => {
  const store = createRelationshipStore({ indexedDB: undefined });
  const env = browser();
  const warnings = [];
  const live = createDataSource({
    store,
    site: createSite({
      window: env.window,
      requests: createRequests({ fetch: env.fetch }),
    }),
    onWarning: (warning) => warnings.push(warning),
  });
  assert.ok(Number.isFinite(await live.estimate([["alice", "friends"]])));
  assert.deepEqual(
    (await live.load([["alice", "friends"]]))[0].snapshot.members,
    ["bob"],
  );
  assert.equal(warnings.length, 1);
  env.window.close();
});

test("HTTP 失败保留旧观察，不写空关系或原站错误声明", async () => {
  const store = createRelationshipStore({ indexedDB: new IDBFactory() });
  await store.commit({
    relationships: {
      alice: {
        friends: { status: "available", members: ["old"], fetchedAt: 1 },
      },
    },
  });
  const env = browser();
  const site = createSite({
    window: env.window,
    requests: createRequests({
      fetch: async () => new Response("", { status: 403 }),
    }),
  });
  await assert.rejects(
    createDataSource({ store, site }).load([["alice", "friends"]]),
    /403/,
  );
  const saved = await store.read({ relationships: [["alice", "friends"]] });
  assert.deepEqual(saved.relationships.alice.friends.members, ["old"]);
  env.window.close();
});

test("旧关系仅影响扩展成本，不进入网络证明或展示资料", async () => {
  const store = createRelationshipStore({ indexedDB: new IDBFactory() });
  await store.commit({
    relationships: {
      alice: {
        friends: { status: "available", members: ["bob"], fetchedAt: 1 },
      },
    },
    users: { ghost: { name: "旧昵称", avatar: "", fetchedAt: 1 } },
  });
  const env = browser({ edges: { alice: [], bob: [] } });
  const live = createDataSource({
    store,
    site: createSite({
      window: env.window,
      requests: createRequests({ fetch: env.fetch }),
    }),
  });
  assert.ok(Number.isFinite(await live.estimate([["alice", "friends"]])));
  assert.equal((await live.users(["ghost"])).get("ghost").name, "ghost");
  const result = await search({
    start: "alice",
    end: "bob",
    mode: "directed",
    source: live,
  });
  assert.equal(result.status, "unreachable");
  assert.ok(env.urls.length > 0);
  env.window.close();
});

test("缓存成本改变扩展顺序，但不改变网络关系的结论", async (t) => {
  for (const cheap of ["alice", "bob"]) {
    const store = createRelationshipStore({ indexedDB: new IDBFactory() });
    const expensive = Array.from({ length: 1000 }, (_, index) => `old${index}`);
    await store.commit({
      relationships: {
        alice: {
          friends: {
            status: "available",
            members: cheap === "alice" ? [] : expensive,
            fetchedAt: 1,
          },
        },
        bob: {
          rev_friends: {
            status: "available",
            members: cheap === "bob" ? [] : expensive,
            fetchedAt: 1,
          },
        },
      },
    });
    const env = browser({ edges: { alice: [], bob: [] } });
    t.after(() => env.window.close());
    const source = createDataSource({
      store,
      site: createSite({
        window: env.window,
        requests: createRequests({ fetch: env.fetch }),
      }),
    });
    const result = await search({
      start: "alice",
      end: "bob",
      mode: "directed",
      source,
    });
    assert.equal(result.status, "unreachable");
    assert.equal(
      env.urls[0],
      `https://bgm.tv/user/${cheap}/${cheap === "alice" ? "friends" : "rev_friends"}`,
    );
  }
});

const emptyObservation = () => ({
  snapshot: { status: "available", members: [], fetchedAt: 1 },
  users: [],
});

test("宽搜索层按需启动观察，完成后仍按输入顺序返回整个批次", async () => {
  const gate = deferred();
  const calls = [];
  let active = 0;
  let peak = 0;
  const source = createDataSource({
    site: {
      relationships: async (id) => {
        calls.push(id);
        peak = Math.max(peak, ++active);
        await gate.promise;
        active--;
        return emptyObservation();
      },
    },
    store: { commit: async () => {} },
  });
  const keys = Array.from({ length: 2000 }, (_, index) => [
    `u${index}`,
    "friends",
  ]);
  const pending = source.load(keys);
  await until(() => calls.length === 4);
  assert.equal(calls.length, 4);
  gate.resolve();
  const records = await pending;
  assert.ok(peak <= 4);
  assert.deepEqual(
    records.map(({ id, direction }) => [id, direction]),
    keys,
  );
  await source.load(keys);
  assert.equal(calls.length, keys.length);
});

test("取消宽搜索层不再启动后续观察，底层不响应取消也能释放请求名额", async () => {
  const calls = [];
  const commits = [];
  const requests = createRequests({
    fetch: (url) => {
      calls.push(url);
      return url.endsWith("/fresh")
        ? Promise.resolve(new Response("ok"))
        : new Promise(() => {});
    },
  });
  const source = createDataSource({
    site: {
      relationships: async (id, direction, { signal }) => {
        await requests.text(`https://bgm.tv/user/${id}/${direction}`, {
          signal,
        });
        return emptyObservation();
      },
    },
    store: { commit: async (value) => commits.push(value) },
  });
  const abort = new AbortController();
  const pending = source.load(
    Array.from({ length: 2000 }, (_, index) => [`u${index}`, "friends"]),
    { signal: abort.signal },
  );
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await until(() => calls.length === 4);
  abort.abort();
  await rejected;
  assert.equal(await requests.text("https://bgm.tv/fresh"), "ok");
  assert.equal(calls.length, 5);
  assert.equal(commits.length, 0);
});

test("网络完成顺序独立于缓存提交顺序，并发重复观察只获取一次", async () => {
  const network = [deferred(), deferred()];
  const commit = deferred();
  const committed = [];
  const calls = [];
  const source = createDataSource({
    site: {
      relationships: async (id) => {
        calls.push(id);
        await network[id === "a" ? 0 : 1].promise;
        return emptyObservation();
      },
    },
    store: {
      commit: async ({ relationships }) => {
        const id = Object.keys(relationships)[0];
        if (id === "b") await commit.promise;
        committed.push(id);
      },
    },
  });
  const pending = source.load([
    ["a", "friends"],
    ["b", "friends"],
  ]);
  const duplicate = source.load([["a", "friends"]]);
  network[1].resolve();
  await new Promise((resolve) => setImmediate(resolve));
  network[0].resolve();
  await until(() => committed.includes("a"));
  commit.resolve();
  const [a, b] = await pending;
  assert.ok(b.order < a.order);
  assert.deepEqual(committed, ["a", "b"]);
  assert.deepEqual(calls, ["a", "b"]);
  assert.deepEqual(await duplicate, [a]);
});

test("观察失败后停止生产后续任务，其他已完成方向仍可独立提交", async () => {
  const failure = deferred();
  const success = deferred();
  const calls = [];
  const commits = [];
  const source = createDataSource({
    site: {
      relationships: async (id) => {
        calls.push(id);
        if (id === "u0") await failure.promise;
        else await success.promise;
        return emptyObservation();
      },
    },
    store: { commit: async (value) => commits.push(value) },
  });
  const pending = source.load(
    Array.from({ length: 20 }, (_, index) => [`u${index}`, "friends"]),
  );
  const rejected = assert.rejects(pending, /broken/);
  failure.reject(new Error("broken"));
  await rejected;
  success.resolve();
  await until(() => commits.length === 3);
  assert.deepEqual(calls, ["u0", "u1", "u2", "u3"]);
});
