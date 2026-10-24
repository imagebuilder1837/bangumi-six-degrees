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

test("分页完整获取后再返回关系，第一页别名不重复抓取", async () => {
  const urls = [];
  const requests = createRequests({
    fetch: async (url) => {
      urls.push(url);
      const members =
        new URL(url).searchParams.get("page") === "2" ? ["carol"] : ["bob"];
      return new Response(
        listing("alice", members) +
          '<div class="page_inner"><a href="?page=1">1</a><a href="?page=2">2</a></div>',
      );
    },
  });
  const site = createSite({ window, requests, origin: "https://bgm.tv" });
  const result = await site.relationships("alice", "friends");
  assert.deepEqual(result.snapshot.members, ["bob", "carol"]);
  assert.equal(urls.length, 2);
});

test("不接受其他网站链接和无法解释的列表分页", () => {
  for (const input of [
    "bad/name",
    "https://",
    "https://example.com/user/alice",
    "https://bgm.tv/user/a%2Fb",
    "https://bgm.tv/user/%ZZ",
  ])
    assert.throws(() => normalizeInput(input), { code: "invalid-input" });
  assert.throws(() =>
    readRelationships(
      window,
      listing("alice", []) +
        '<div class="page_inner"><a href="/login">2</a></div>',
      "alice",
      "https://bgm.tv/user/alice/friends",
    ),
  );
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
