import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createRequests } from "../src/requests.mjs";
import { createSite } from "../src/site.mjs";
import { home, listing } from "./support/browser.mjs";
import { createRandomUsers } from "../src/random-users.mjs";
import { createSession } from "../src/session.mjs";
import { deferred } from "./support/async.mjs";

// Fetch exposes the final URL after following the observed /user/192026 302.
// The HTML is synthetic; only the observed identity and links are retained.
function response(body, url, status = 200) {
  return Object.defineProperty(new Response(body, { status }), "url", {
    value: url,
  });
}

function setup(t, fetch, requestOptions = {}) {
  const window = new JSDOM("").window;
  t.after(() => window.close());
  const requests = createRequests({ fetch, ...requestOptions });
  return {
    requests,
    site: createSite({ window, requests, origin: "https://bgm.tv" }),
  };
}

test("随机候选与手输均接受同源规范主页跳转，不额外查身份", async (t) => {
  const urls = [];
  const { site } = setup(t, async (url, options) => {
    urls.push(url);
    assert.equal(options.credentials, "same-origin");
    return response(home("yu_nagi"), "https://bgm.tv/user/yu_nagi");
  });
  for (const user of [
    await site.candidate(192026),
    await site.resolve("192026"),
    await site.resolve("old_name"),
  ]) {
    assert.equal(user.id, "yu_nagi");
    assert.equal(user.friendsUrl, "https://bgm.tv/user/yu_nagi/friends");
  }
  assert.deepEqual(urls, [
    "https://bgm.tv/user/192026",
    "https://bgm.tv/user/192026",
    "https://bgm.tv/user/old_name",
  ]);
});

test("无跳转数字主页仍按正文归一，纯数字用户标识和主页尾斜线也合法", async (t) => {
  for (const [target, id] of [
    ["https://bgm.tv/user/192026", "yu_nagi"],
    ["https://bgm.tv/user/634419", "634419"],
    ["https://bgm.tv/user/yu_nagi/", "yu_nagi"],
  ]) {
    const { site } = setup(t, async () => response(home(id), target));
    assert.equal((await site.candidate(192026)).id, id);
  }
});

test("跨域、非主页及带额外参数的目标均中性报错且不重试", async (t) => {
  for (const target of [
    "https://bangumi.tv/user/yu_nagi",
    "https://example.com/user/yu_nagi",
    "https://example.com/login",
    "https://bgm.tv/",
    "https://bgm.tv/challenge",
    "https://bgm.tv/user/yu_nagi/friends",
    "https://bgm.tv/user/yu_nagi?next=other",
    "https://bgm.tv/user/yu_nagi#other",
    "https://bgm.tv/user/a%2Fb",
    "https://bgm.tv/user/%ZZ",
    "https://someone@bgm.tv/user/yu_nagi",
  ]) {
    const { site, requests } = setup(t, async () =>
      response(home("yu_nagi"), target),
    );
    await assert.rejects(site.candidate(192026), (error) => {
      assert.match(error.message, /非预期页面/);
      assert.doesNotMatch(error.message, /登录/);
      assert.equal(error.status, undefined);
      return true;
    });
    assert.equal(requests.count, 1);
  }
});

test("仅明确的同源登录目标提示检查登录", async (t) => {
  const { site, requests } = setup(t, async () =>
    response("", "https://bgm.tv/login?back=user"),
  );
  await assert.rejects(
    site.resolve("192026"),
    /跳转到登录页面，请检查登录状态/,
  );
  assert.equal(requests.count, 1);
});

test("跳转主页身份、好友链接或结构不可信时终止而非冒充缺失候选", async (t) => {
  const missing =
    '<div id="colunmNotice"><img src="/img/bangumi/404.png"><h2>呜咕，出错了</h2><p class="text">数据库中没有查询到该用户的信息</p></div>';
  for (const [body, status, expected] of [
    [home("other"), 200, /身份不匹配/],
    [
      home("yu_nagi").replace("/user/yu_nagi/friends", "/user/other/friends"),
      200,
      /好友链接身份不匹配/,
    ],
    ["<title>challenge</title>", 200, /无法识别主页用户/],
    [missing, 200, /无法识别主页用户/],
    ["", 404, /404/],
  ]) {
    const { site, requests } = setup(t, async () =>
      response(body, "https://bgm.tv/user/yu_nagi", status),
    );
    await assert.rejects(site.candidate(192026), (error) => {
      assert.match(error.message, expected);
      assert.doesNotMatch(error.message, /登录/);
      return true;
    });
    assert.equal(requests.count, 1);
  }
});

test("主页跳转例外不放宽两向关系列表及后续分页", async (t) => {
  for (const direction of ["friends", "rev_friends"]) {
    const { site, requests } = setup(t, async () =>
      response(listing("other", []), `https://bgm.tv/user/other/${direction}`),
    );
    await assert.rejects(
      site.relationships("yu_nagi", direction),
      /非预期页面/,
    );
    assert.equal(requests.count, 1);
  }
  const { site, requests } = setup(t, async (url) =>
    url.includes("?page=2")
      ? response(listing("yu_nagi", []), "https://bgm.tv/user/yu_nagi/friends")
      : response(
          listing("yu_nagi", []) +
            '<div class="page_inner"><a href="?page=2">2</a></div>',
          url,
        ),
  );
  await assert.rejects(site.relationships("yu_nagi", "friends"), /非预期页面/);
  assert.equal(requests.count, 2);
});

test("被拒绝目标上的 429 和 503 不重试也不改变全局限流", async (t) => {
  for (const status of [429, 503]) {
    const waits = [];
    const { site, requests } = setup(
      t,
      async (url) =>
        url.endsWith("/192026")
          ? response("", "https://bgm.tv/challenge", status)
          : response(home("self"), url),
      { sleep: async (ms) => waits.push(ms) },
    );
    await assert.rejects(site.candidate(192026), /非预期页面/);
    assert.equal((await site.resolve("self")).id, "self");
    assert.equal(requests.count, 2);
    assert.deepEqual(waits, []);
  }
});

test("合法主页目标沿用 HTTP 重试与限流，且只校验最后一次响应的身份", async (t) => {
  for (const status of [429, 503]) {
    let attempts = 0;
    let time = 0;
    const waits = [];
    const { site, requests } = setup(
      t,
      async (url) => {
        if (++attempts === 1) {
          const failed = response("", "https://bgm.tv/user/other", status);
          failed.headers.set("Retry-After", "5");
          return failed;
        }
        return response(home("yu_nagi"), url);
      },
      {
        now: () => time,
        sleep: async (ms) => {
          waits.push(ms);
          time += ms;
        },
      },
    );
    assert.equal((await site.candidate(192026)).id, "yu_nagi");
    assert.equal(requests.count, 2);
    assert.deepEqual(waits, [status === 429 ? 5000 : 1000]);
  }
});

test("跳转后的正文不响应取消时，仍能停止并释放共享队列", async (t) => {
  const reading = deferred();
  const { site } = setup(
    t,
    async (url) => {
      if (url.endsWith("/self")) return response(home("self"), url);
      return {
        ok: true,
        status: 200,
        url: "https://bgm.tv/user/yu_nagi",
        text: () => {
          reading.resolve();
          return new Promise(() => {});
        },
      };
    },
    { concurrency: 1 },
  );
  const abort = new AbortController();
  const pending = site.candidate(192026, { signal: abort.signal });
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await reading.promise;
  const queued = site.resolve("self");
  abort.abort();
  await rejected;
  assert.equal((await queued).id, "self");
});

test("跳转后的正文超时仍按原规则重试两次", async (t) => {
  const { site, requests } = setup(
    t,
    async () => ({
      ok: true,
      status: 200,
      url: "https://bgm.tv/user/yu_nagi",
      text: () => new Promise(() => {}),
    }),
    { timeout: 5, sleep: async () => {} },
  );
  await assert.rejects(site.candidate(192026), /超时/);
  assert.equal(requests.count, 3);
});

test("随机填入贯穿真实主页归一和两向校验，未知跳转则保留原端点而不换人", async (t) => {
  for (const rejected of [false, true]) {
    const urls = [];
    const commits = [];
    const { site } = setup(t, async (url) => {
      urls.push(url);
      if (url.endsWith("/192027")) return response("", url, 404);
      if (url.endsWith("/192026"))
        return response(
          home("yu_nagi"),
          rejected ? "https://bgm.tv/challenge" : "https://bgm.tv/user/yu_nagi",
        );
      return response(listing("yu_nagi", []), url);
    });
    const store = { commit: async (batch) => commits.push(batch) };
    const randomUsers = createRandomUsers({
      site,
      store,
      now: () => 0,
      seed: { range: 192026, observed: 192026, checkedAt: 0 },
      random: () => 192025.5 / 192026,
    });
    await randomUsers.refresh();
    urls.length = 0;
    const session = createSession({
      site,
      store,
      randomUsers,
      current: { id: "self" },
    });
    await session.random(0);
    assert.equal(session.state.inputs[0], rejected ? "self" : "yu_nagi");
    assert.equal(session.state.endpoints[0].id, rejected ? "self" : "yu_nagi");
    assert.equal(session.state.phase, "idle");
    assert.equal(session.state.result, null);
    if (rejected) {
      assert.match(session.state.errors[0], /非预期页面/);
      assert.deepEqual(urls, ["https://bgm.tv/user/192026"]);
      assert.equal(commits.length, 0);
    } else {
      assert.equal(session.state.errors[0], "");
      assert.deepEqual(urls, [
        "https://bgm.tv/user/192026",
        "https://bgm.tv/user/yu_nagi/friends",
        "https://bgm.tv/user/yu_nagi/rev_friends",
      ]);
      assert.equal(commits.length, 2);
    }
  }
});
