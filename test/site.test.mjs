import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import {
  readHome,
  readRelationships,
  normalizeInput,
  createSite,
} from "../src/site.mjs";
import { createRequests } from "../src/requests.mjs";
import { listing } from "./support/browser.mjs";

test("两类已知原站错误与普通结构损坏严格区分", async () => {
  const errorPage = await fixture("unavailable");
  assert.equal(
    readRelationships(
      window,
      errorPage,
      "bad",
      "https://bgm.tv/user/bad/friends",
      "[已注销]",
    ).status,
    "unavailable",
  );
  assert.throws(() =>
    readRelationships(
      window,
      errorPage,
      "bad",
      "https://bgm.tv/user/bad/friends",
      "正常昵称",
    ),
  );
  assert.equal(
    readRelationships(
      window,
      listing("bad", []),
      "bad",
      "https://bgm.tv/user/bad/friends",
      "[已注销]",
    ).status,
    "available",
  );
  const missing = (await fixture("friends")).replace("/user/bob", "/user/");
  const parsed = readRelationships(
    window,
    missing,
    "alice",
    "https://bgm.tv/user/alice/friends",
  );
  assert.equal(parsed.missingIdentifiers, 1);
  assert.deepEqual(parsed.members, []);
  assert.throws(() =>
    readRelationships(
      window,
      missing.replace('class="avatar"', 'class="broken"'),
      "alice",
      "https://bgm.tv/user/alice/friends",
    ),
  );
  const challenge = await fixture("challenge");
  assert.throws(() =>
    readRelationships(
      window,
      challenge,
      "alice",
      "https://bgm.tv/user/alice/friends",
    ),
  );
});

test("两向关系列表各读取单次响应，保留去重后的成员和资料", async () => {
  const urls = [];
  const requests = createRequests({
    fetch: async (url) => {
      urls.push(url);
      return new Response(listing("alice", ["bob", "carol", "bob"]));
    },
  });
  const site = createSite({
    window,
    requests,
    origin: "https://bgm.tv",
    now: () => 123,
  });
  for (const direction of ["friends", "rev_friends"]) {
    const result = await site.relationships("alice", direction);
    assert.deepEqual(result.snapshot, {
      status: "available",
      members: ["bob", "carol"],
      fetchedAt: 123,
    });
    assert.deepEqual(
      result.users.map(({ id }) => id),
      ["bob", "carol", "alice"],
    );
  }
  assert.deepEqual(urls, [
    "https://bgm.tv/user/alice/friends",
    "https://bgm.tv/user/alice/rev_friends",
  ]);
});

test("发现分页控件则失败，不解析页码或请求后续页面", async () => {
  for (const direction of ["friends", "rev_friends"]) {
    for (const className of [
      "page_inner",
      "multipage",
      "pagination",
      "paginator",
    ]) {
      const urls = [];
      const requests = createRequests({
        fetch: async (url) => {
          urls.push(url);
          return new Response(
            listing("alice", ["bob"]) +
              `<div class="${className}"><a href="?page=2">2</a></div>`,
          );
        },
      });
      const site = createSite({ window, requests, origin: "https://bgm.tv" });
      await assert.rejects(
        site.relationships("alice", direction),
        /不支持关系列表分页/,
      );
      assert.deepEqual(urls, [`https://bgm.tv/user/alice/${direction}`]);
    }
  }
});

test("不接受其他网站链接和无效用户标识", () => {
  for (const input of [
    "bad/name",
    "https://",
    "https://example.com/user/alice",
    "https://bgm.tv/user/a%2Fb",
    "https://bgm.tv/user/%ZZ",
  ])
    assert.throws(() => normalizeInput(input), { code: "invalid-input" });
});
const window = new JSDOM("").window;
const fixture = (name) =>
  readFile(new URL(`fixtures/${name}.html`, import.meta.url), "utf8");

test("主页数字 ID 以身份头归一为 username，不能拼接数字关系子路由", async () => {
  const home = readHome(
    new window.DOMParser().parseFromString(await fixture("home"), "text/html"),
    "https://bgm.tv/user/123",
  );
  assert.equal(home.id, "alice");
  assert.equal(home.friendsUrl, "https://bgm.tv/user/alice/friends");
  assert.equal(normalizeInput("https://chii.in/user/123?foo=1#x"), "123");
});

test("列表扫描同时取得身份、昵称和头像，并去重", async () => {
  const html = await fixture("friends");
  const repeated = html.replace(
    "</ul>",
    html.match(/<li class="user">.*<\/li>/s)[0] + "</ul>",
  );
  const result = readRelationships(
    window,
    repeated,
    "alice",
    "https://bgm.tv/user/alice/friends",
  );
  assert.deepEqual(
    result.members.map((user) => user.id),
    ["bob"],
  );
  assert.equal(result.members[0].name, "鲍勃");
  assert.match(result.members[0].avatar, /^https:\/\/lain.bgm.tv\//);
});
