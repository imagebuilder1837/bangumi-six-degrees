import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createSite } from "../src/site.mjs";
import { createRequests } from "../src/requests.mjs";
import { home } from "./support/browser.mjs";

// Synthetic sample preserving the selectors observed on /user/999999999.
const missing =
  '<div id="colunmNotice"><img src="/img/bangumi/404.png"><h2>呜咕，出错了</h2><p class="text">数据库中没有查询到该用户的信息</p></div>';

test("数字候选先归一主页，明确不存在可重抽，普通错误不得伪装为空候选", async () => {
  const window = new JSDOM("").window;
  const siteFor = (body, status = 200) =>
    createSite({
      window,
      origin: "https://bgm.tv",
      requests: createRequests({
        fetch: async () => new Response(body, { status }),
      }),
    });
  const user = await siteFor(home("renamed")).candidate(12);
  assert.equal(user.id, "renamed");
  assert.equal(user.friendsUrl, "https://bgm.tv/user/renamed/friends");
  assert.equal(await siteFor(missing).candidate(999999999), null);
  assert.equal(await siteFor("", 404).candidate(999999999), null);
  await assert.rejects(siteFor("", 403).candidate(12), /403/);
  await assert.rejects(
    siteFor("<title>challenge</title>").candidate(12),
    /识别/,
  );
  await assert.rejects(
    siteFor(
      missing.replace("数据库中没有查询到该用户的信息", "请登录"),
    ).candidate(12),
    /识别/,
  );
  await assert.rejects(siteFor(missing).resolve("999999999"), /识别/);
  window.close();
});
