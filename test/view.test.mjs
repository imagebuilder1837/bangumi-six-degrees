import test from "node:test";
import assert from "node:assert/strict";
import { initialize } from "../src/entry.mjs";
import { mountView } from "../src/view.mjs";
import { browser, until } from "./support/browser.mjs";
import { deferred } from "./support/async.mjs";

function key(window, element, value, options = {}) {
  const event = new window.KeyboardEvent("keydown", {
    key: value,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  element.dispatchEvent(event);
  return event;
}
function pointer(window, element) {
  element.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
  element.focus();
}

test("鼠标点击输入框隐藏外框，键盘导航显示，输入和异步确认保留焦点", async () => {
  const env = browser();
  const session = initialize(env.window, { fetch: env.fetch });
  const { document } = env.window;
  const launcher = document.querySelector(".bsd-entry-link");
  const host = document.createElement("button");
  document.body.prepend(host);
  host.focus();
  key(env.window, host, "Tab");
  launcher.focus();
  assert.match(env.window.getComputedStyle(launcher).outline, /solid/);
  pointer(env.window, launcher);
  launcher.click();
  const input = document.querySelector('[aria-label="终点用户"]');
  assert.equal(document.activeElement, input);
  assert.match(env.window.getComputedStyle(input).outline, /none/);
  key(env.window, input, "Tab");
  assert.match(env.window.getComputedStyle(input).outline, /solid/);
  pointer(env.window, input);
  assert.match(env.window.getComputedStyle(input).outline, /none/);
  input.value = "bob";
  input.setSelectionRange(1, 1);
  input.dispatchEvent(new env.window.Event("input", { bubbles: true }));
  assert.equal(document.activeElement, input);
  assert.equal(input.selectionStart, 1);
  await session.resolve(1);
  assert.equal(document.activeElement, input);
  assert.match(env.window.getComputedStyle(input).outline, /none/);
  key(env.window, input, "Escape");
  assert.equal(document.activeElement, launcher);
  assert.match(env.window.getComputedStyle(launcher).outline, /solid/);
  assert.equal(document.documentElement.hasAttribute("data-focus"), false);
  env.window.close();
});

test("两端输入框获得焦点时全选，编辑期间保留光标位置", async (t) => {
  const env = browser();
  t.after(() => env.window.close());
  const session = initialize(env.window, { fetch: env.fetch });
  const { document } = env.window;
  document.querySelector(".bsd-entry-link").click();
  await session.fill(1, "bob");
  const inputs = [...document.querySelectorAll(".bsd-input input")];
  for (const input of inputs) {
    document.querySelector(".bsd-close").focus();
    pointer(env.window, input);
    assert.equal(input.selectionStart, 0);
    assert.equal(input.selectionEnd, input.value.length);
    input.setSelectionRange(1, 1);
    input.dispatchEvent(new env.window.Event("input", { bubbles: true }));
    assert.equal(input.selectionStart, 1);
    assert.equal(input.selectionEnd, 1);
    document.querySelector(".bsd-close").focus();
    key(env.window, document.activeElement, "Tab");
    input.focus();
    assert.equal(input.selectionStart, 0);
    assert.equal(input.selectionEnd, input.value.length);
  }
});

test("两端 Enter（含修饰键）仅失焦确认身份，不启动探索或切换焦点外框", async (t) => {
  for (const index of [0, 1]) {
    for (const keyboard of [false, true]) {
      for (const options of [
        {},
        { shiftKey: true },
        { ctrlKey: true },
        { altKey: true },
        { metaKey: true },
      ]) {
        await t.test(
          `${index}/${keyboard}/${JSON.stringify(options)}`,
          async (t) => {
            const gate = deferred();
            const env = browser({
              beforeFetch: async (url) => {
                if (url.endsWith("/user/bob")) await gate.promise;
              },
            });
            t.after(() => {
              gate.resolve();
              env.window.close();
            });
            const session = initialize(env.window, { fetch: env.fetch });
            const { document } = env.window;
            document.querySelector(".bsd-entry-link").click();
            const input = document.querySelectorAll(".bsd-input input")[index];
            pointer(env.window, input);
            if (keyboard) key(env.window, input, "Tab");
            input.value = "https://bgm.tv/user/bob";
            input.dispatchEvent(
              new env.window.Event("input", { bubbles: true }),
            );
            const enter = key(env.window, input, "Enter", options);
            assert.equal(enter.defaultPrevented, true);
            assert.equal(document.activeElement, document.body);
            assert.equal(input.value, "https://bgm.tv/user/bob");
            assert.equal(session.state.endpoints[index].activity, "resolving");
            assert.equal(session.state.phase, "idle");
            // Inspect actual focused controls, not just the stored input modality.
            assert.equal(document.querySelector(".bsd-overlay :focus"), null);
            const explore = document.querySelector('[data-action="explore"]');
            explore.focus();
            assert.match(
              env.window.getComputedStyle(explore).outline,
              keyboard ? /solid/ : /none/,
            );
            explore.blur();
            gate.resolve();
            await until(
              () => session.state.endpoints[index].activity === "idle",
            );
            assert.equal(input.value, "bob");
            assert.equal(session.state.endpoints[index].user.id, "bob");
            assert.equal(document.activeElement, document.body);
            assert.equal(session.state.phase, "idle");
            assert.equal(
              env.urls.some((url) => /\/(friends|rev_friends)/.test(url)),
              false,
            );
            assert.equal(document.querySelector(".bsd-pulse").hidden, true);
          },
        );
      }
    }
  }
});

test("Enter 保留空输入、身份错误和已确认用户的普通失焦行为", async (t) => {
  const env = browser();
  t.after(() => env.window.close());
  const session = initialize(env.window, { fetch: env.fetch });
  const { document } = env.window;
  document.querySelector(".bsd-entry-link").click();
  const input = document.querySelector('[aria-label="终点用户"]');
  for (const value of ["", "bad/name", "bob", "bob"]) {
    pointer(env.window, input);
    if (input.value !== value) {
      input.value = value;
      input.dispatchEvent(new env.window.Event("input", { bubbles: true }));
    }
    const requests = env.urls.length;
    const confirmed = !!session.state.endpoints[1].user;
    key(env.window, input, "Enter");
    await until(() => session.state.endpoints[1].activity === "idle");
    assert.equal(document.activeElement, document.body);
    assert.equal(session.state.phase, "idle");
    assert.equal(input.value, value);
    assert.equal(
      input.getAttribute("aria-invalid"),
      String(value === "bad/name"),
    );
    if (value !== "bob" || confirmed) assert.equal(env.urls.length, requests);
  }
  assert.equal(env.urls.filter((url) => url.endsWith("/user/bob")).length, 1);
});

test("输入法 Enter 不失焦；结束输入后的长按不会激活其他控件，松开后恢复键盘操作", async (t) => {
  const env = browser();
  t.after(() => env.window.close());
  const session = initialize(env.window, { fetch: env.fetch });
  const { document } = env.window;
  document.querySelector(".bsd-entry-link").click();
  await session.fill(1, "bob");
  const input = document.querySelector('[aria-label="终点用户"]');
  pointer(env.window, input);
  input.dispatchEvent(
    new env.window.CompositionEvent("compositionstart", { bubbles: true }),
  );
  const composing = key(env.window, input, "Enter", { isComposing: true });
  assert.equal(composing.defaultPrevented, false);
  assert.equal(document.activeElement, input);
  assert.match(env.window.getComputedStyle(input).outline, /none/);
  input.dispatchEvent(
    new env.window.CompositionEvent("compositionend", { bubbles: true }),
  );
  key(env.window, input, "Enter", { repeat: true });
  assert.equal(document.activeElement, input);
  key(env.window, input, "Enter");
  assert.equal(document.activeElement, document.body);
  const explore = document.querySelector('[data-action="explore"]');
  const repeated = key(env.window, document.body, "Enter", { repeat: true });
  assert.equal(repeated.defaultPrevented, true);
  explore.focus();
  assert.equal(
    key(env.window, explore, "Enter", { repeat: true }).defaultPrevented,
    true,
  );
  assert.match(env.window.getComputedStyle(explore).outline, /none/);
  assert.equal(session.state.phase, "idle");
  document.dispatchEvent(
    new env.window.KeyboardEvent("keyup", { key: "Enter", bubbles: true }),
  );
  assert.equal(key(env.window, explore, "Enter").defaultPrevented, false);
  assert.match(env.window.getComputedStyle(explore).outline, /solid/);
  // jsdom does not synthesize native button activation from keyboard events.
  explore.click();
  await until(() => session.state.phase === "complete");
});

test("两端 Enter 失焦后 Escape 仍关闭弹窗，隐藏时不拦截原站 Escape", (t) => {
  const env = browser();
  t.after(() => env.window.close());
  const session = initialize(env.window, { fetch: env.fetch });
  const { document } = env.window;
  const launcher = document.querySelector(".bsd-entry-link");
  for (const input of document.querySelectorAll(".bsd-input input")) {
    launcher.click();
    pointer(env.window, input);
    key(env.window, input, "Enter");
    assert.equal(document.activeElement, document.body);
    assert.equal(session.state.visible, true);
    assert.equal(
      key(env.window, document.body, "Escape").defaultPrevented,
      true,
    );
    assert.equal(session.state.visible, false);
    assert.equal(document.activeElement, launcher);
    assert.match(env.window.getComputedStyle(launcher).outline, /solid/);
  }
  const host = document.createElement("button");
  document.body.append(host);
  host.focus();
  assert.equal(key(env.window, host, "Escape").defaultPrevented, false);
  assert.equal(document.activeElement, host);
});

test("显式开始探索时聚焦停止按钮，完成后聚焦探索按钮并保留键盘外框", async (t) => {
  const gate = deferred();
  const env = browser({
    beforeFetch: async (url) => {
      if (url.endsWith("/alice/friends")) await gate.promise;
    },
  });
  t.after(() => {
    gate.resolve();
    env.window.close();
  });
  const session = initialize(env.window, { fetch: env.fetch });
  const { document } = env.window;
  document.querySelector(".bsd-entry-link").click();
  await session.fill(1, "bob");
  const input = document.querySelector('[aria-label="终点用户"]');
  input.focus();
  const hint = document.querySelector(".bsd-hint");
  assert.equal(hint.textContent, "");
  assert.equal(
    document.querySelector('[data-action="explore"]').textContent,
    "开始探索 ↗",
  );
  const explore = document.querySelector('[data-action="explore"]');
  explore.focus();
  key(env.window, explore, "Enter");
  explore.click();
  await until(() => session.state.phase === "running");
  const stop = document.querySelector('[data-action="stop"]');
  assert.equal(document.activeElement, stop);
  assert.equal(hint.textContent, "");
  assert.equal(explore.textContent, "探索中…");
  assert.equal(document.querySelector(".bsd-pulse").hidden, false);
  assert.equal(document.querySelector(".bsd-progress").hidden, false);
  assert.match(env.window.getComputedStyle(stop).outline, /solid/);
  gate.resolve();
  await until(() => session.state.phase === "complete");
  assert.equal(document.activeElement, explore);
  assert.equal(hint.textContent, "");
  assert.equal(explore.textContent, "开始探索 ↗");
  assert.match(env.window.getComputedStyle(explore).outline, /solid/);
  assert.equal(document.querySelector(".bsd-pulse").hidden, true);
  assert.equal(document.querySelector(".bsd-progress").hidden, true);
  assert.equal(document.querySelector(".bsd-hop-count").textContent, "1");
  assert.equal(document.querySelectorAll(".bsd-path a").length, 2);
  env.window.close();
});

test("键盘焦点在弹窗内循环，鼠标关闭后入口隐藏焦点外框", () => {
  const env = browser();
  initialize(env.window, { fetch: env.fetch });
  const { document } = env.window;
  const launcher = document.querySelector(".bsd-entry-link");
  launcher.click();
  const close = document.querySelector(".bsd-close");
  const explore = document.querySelector('[data-action="explore"]');
  explore.focus();
  key(env.window, explore, "Tab");
  assert.equal(document.activeElement, close);
  key(env.window, close, "Tab", { shiftKey: true });
  assert.equal(document.activeElement, explore);
  pointer(env.window, close);
  close.click();
  assert.equal(document.activeElement, launcher);
  assert.match(env.window.getComputedStyle(launcher).outline, /none/);
  assert.equal(document.querySelector('[role="dialog"]').hidden, true);
  env.window.close();
});

test("用户确认和两端错误集中在左下角，输入框关联提示且修改后清除旧错误", async (t) => {
  const gate = deferred();
  const env = browser({
    beforeFetch: async (url) => {
      if (url.endsWith("/user/bob")) {
        await gate.promise;
        return new Response("", { status: 404 });
      }
    },
  });
  t.after(() => {
    gate.resolve();
    env.window.close();
  });
  const session = initialize(env.window, { fetch: env.fetch });
  session.open();
  const { document } = env.window;
  const hint = document.querySelector(".bsd-hint");
  const pending = session.fill(1, "bob");
  assert.equal(hint.textContent, "正在确认终点用户…");
  assert.doesNotMatch(
    document.querySelector('[data-endpoint="1"]').textContent,
    /正在确认/,
  );
  await session.fill(0, "bad/name");
  assert.match(hint.textContent, /请输入有效的起点用户标识/);
  assert.match(hint.textContent, /正在确认终点用户/);
  gate.resolve();
  await pending;
  assert.ok(session.state.endpoints.every(({ error }) => !!error));
  for (const [index, field] of [
    ...document.querySelectorAll(".bsd-input input"),
  ].entries()) {
    assert.equal(field.getAttribute("aria-invalid"), "true");
    assert.equal(
      document.getElementById(field.getAttribute("aria-describedby")),
      hint,
    );
    assert.ok(
      hint.textContent.includes(
        index === 0
          ? "请输入有效的起点用户标识"
          : `获取终点用户时出错：${session.state.endpoints[1].error.message}`,
      ),
    );
    assert.ok(
      !document
        .querySelector(`[data-endpoint="${index}"]`)
        .textContent.includes(session.state.endpoints[index].error.message),
    );
  }
  session.setInput(0, "");
  assert.match(hint.textContent, /^获取终点用户时出错：/);
  assert.doesNotMatch(hint.textContent, /起点用户/);
  session.setInput(1, "");
  assert.equal(hint.textContent, "");
});

test("端点报错使用自然语句描述起点和终点用户", async (t) => {
  const env = browser({
    beforeFetch: async (url) => {
      if (url.endsWith("/user/bob"))
        return new Response(
          '<div id="headerProfile"><h1 class="nameSingle"><span class="inner"><span class="name"><a href="/outside">鲍勃</a></span></span></h1></div>',
        );
    },
  });
  t.after(() => env.window.close());
  const session = initialize(env.window, { fetch: env.fetch });
  session.open();
  const hint = env.window.document.querySelector(".bsd-hint");
  await session.fill(1, "bob");
  assert.equal(hint.textContent, "无法识别终点用户");
  await session.fill(0, "bob");
  assert.equal(hint.textContent, "无法识别起点用户；无法识别终点用户");
  session.setInput(1, "");
  await session.fill(0, "bad/name");
  assert.equal(hint.textContent, "请输入有效的起点用户标识");
});

test("零跳描述同一位班友，切换关系模式后清除跳数和路径", async () => {
  const env = browser();
  const session = initialize(env.window, { fetch: env.fetch });
  const { document } = env.window;
  session.open();
  await session.fill(1, "alice");
  await session.run();
  assert.equal(
    document.querySelector(".bsd-message").textContent,
    "同一位班友，0 跳。",
  );
  assert.equal(document.querySelectorAll(".bsd-path a").length, 1);
  const trigger = document.querySelector('[role="combobox"]');
  trigger.focus();
  trigger.click();
  key(env.window, trigger, "ArrowDown");
  assert.equal(document.querySelectorAll(".bsd-path a").length, 1);
  key(env.window, trigger, "Enter");
  assert.equal(document.activeElement, trigger);
  assert.equal(document.querySelector(".bsd-hop-count"), null);
  assert.equal(document.querySelector(".bsd-path"), null);
  assert.equal(document.querySelector(".bsd-idle-mark").hidden, false);
  assert.match(
    document.querySelector(".bsd-mode-note").textContent,
    /起点 → 终点/,
  );
  env.window.close();
});

test("下拉候选仅确认后切换，Escape 分层关闭，离开或重开不提交候选", async (t) => {
  const env = browser();
  t.after(() => env.window.close());
  const session = initialize(env.window, { fetch: env.fetch });
  const { document } = env.window;
  const launcher = document.querySelector(".bsd-entry-link");
  launcher.click();
  const trigger = document.querySelector('[role="combobox"]');
  const popup = document.querySelector('[role="listbox"]');
  trigger.focus();
  key(env.window, trigger, " ");
  key(env.window, trigger, "End");
  assert.equal(session.state.mode, "mutual");
  assert.equal(
    document.getElementById(trigger.getAttribute("aria-activedescendant"))
      .textContent,
    "无向关联",
  );
  key(env.window, trigger, "Escape");
  assert.equal(popup.hidden, true);
  assert.equal(session.state.visible, true);
  assert.equal(document.activeElement, trigger);
  key(env.window, trigger, "Escape");
  assert.equal(session.state.visible, false);
  assert.equal(document.activeElement, launcher);
  launcher.click();
  assert.equal(popup.hidden, true);
  for (const dismiss of ["Tab", "pointer", "blur", "close"]) {
    trigger.focus();
    trigger.click();
    key(env.window, trigger, "End");
    if (dismiss === "Tab") key(env.window, trigger, "Tab");
    if (dismiss === "pointer")
      pointer(env.window, document.querySelector(".bsd-mode-note"));
    if (dismiss === "blur") document.querySelector(".bsd-close").focus();
    if (dismiss === "close") {
      session.close();
      session.open();
    }
    assert.equal(popup.hidden, true);
    assert.equal(session.state.mode, "mutual");
  }
  trigger.focus();
  trigger.click();
  key(env.window, trigger, "End");
  key(env.window, trigger, " ");
  assert.equal(session.state.mode, "undirected");
  assert.equal(popup.hidden, true);
  assert.equal(document.activeElement, trigger);
  assert.equal(session.state.phase, "idle");
  trigger.click();
  document.querySelectorAll('[role="option"]')[1].click();
  assert.equal(session.state.mode, "directed");
  assert.equal(document.activeElement, trigger);
  assert.equal(env.urls.length, 0);
  await session.fill(1, "bob");
  trigger.click();
  const pending = session.run();
  await until(() => trigger.disabled);
  assert.equal(popup.hidden, true);
  trigger.click();
  assert.equal(popup.hidden, true);
  await pending;
});

test("无向关联逐段展示实际箭头，并提供悬停与读屏关系说明", async (t) => {
  const env = browser({
    edges: { alice: ["b"], b: ["alice", "c"], c: [], bob: ["c"] },
  });
  t.after(() => env.window.close());
  const session = initialize(env.window, { fetch: env.fetch });
  session.open();
  session.setMode("undirected");
  await session.fill(1, "bob");
  await session.run();
  const { document } = env.window;
  const lines = [...document.querySelectorAll(".bsd-path-connection")];
  assert.deepEqual(
    lines.map((line) => [
      line.hasAttribute("marker-end"),
      line.hasAttribute("marker-start"),
    ]),
    [
      [true, true],
      [true, false],
      [false, true],
    ],
  );
  const descriptions = [
    "@alice 与 @b 互相添加为好友",
    "@b 将 @c 添加为好友",
    "@bob 将 @c 添加为好友",
  ];
  const links = [...document.querySelectorAll(".bsd-path a")];
  lines.forEach((line, index) => {
    assert.equal(line.querySelector("title").textContent, descriptions[index]);
    assert.equal(env.window.getComputedStyle(line).pointerEvents, "stroke");
    const description = document.getElementById(
      links[index].getAttribute("aria-describedby"),
    );
    assert.equal(description.textContent, descriptions[index]);
    assert.equal(description.closest('[aria-hidden="true"]'), null);
  });
  assert.equal(links.at(-1).hasAttribute("aria-describedby"), false);
});

test("超过六跳仍展示完整路径并提供轻量彩蛋", async () => {
  const ids = ["alice", "a", "b", "c", "d", "e", "f", "g", "bob"];
  const edges = Object.fromEntries(
    ids.map((id, i) => [id, ids.slice(i + 1, i + 2)]),
  );
  const env = browser({ edges });
  const session = initialize(env.window, { fetch: env.fetch });
  session.open();
  session.setMode("directed");
  await session.fill(1, "bob");
  await session.run();
  const { document } = env.window;
  assert.equal(document.querySelector(".bsd-hop-count").textContent, "8");
  assert.deepEqual(
    [...document.querySelectorAll(".bsd-path a")].map((a) =>
      a.getAttribute("href"),
    ),
    ids.map((id) => `/user/${id}`),
  );
  assert.match(document.querySelector(".bsd-egg").textContent, /六度之外/);
  env.window.close();
});

test("证据不足、不可达和失败分别呈现，候选路径和异常文本均保持安全", () => {
  const env = browser();
  const { document } = env.window;
  let render;
  const state = {
    visible: true,
    phase: "running",
    mode: "mutual",
    endpoints: ["alice", "bob"].map((id) => ({
      input: id,
      user: { id },
      activity: "idle",
      error: null,
    })),
    exclusions: {
      input: "",
      users: [],
      activity: "idle",
      message: "",
      storageWarning: "",
      cacheWarning: "",
    },
    canEdit: false,
    canRun: false,
    canStop: true,
    result: null,
    message: "正在沿好友关系寻找最短路径…",
    warning: "",
    progress: { visited: 4, observations: 3 },
  };
  mountView(
    env.window,
    {
      subscribe(listener) {
        render = listener;
        listener(state);
      },
    },
    { self: "alice", services: document.querySelector(".network_service") },
  );
  assert.equal(
    document.querySelector(".bsd-progress").textContent,
    "已触达 4 位用户 · 已读取 3 份关系列表",
  );
  assert.equal(document.querySelector(".bsd-path"), null);
  for (const [status, message] of [
    ["incomplete", "关系数据不足，路径待确认。"],
    ["unreachable", "已确认不可达"],
    ["invalid", "端点属于已识别的原站无效节点。"],
  ]) {
    Object.assign(state, {
      phase: "complete",
      canEdit: true,
      canRun: true,
      canStop: false,
      message,
      result: {
        status,
        conditions: { mode: "mutual" },
        path: [{ id: "candidate" }],
      },
    });
    render(state);
    assert.equal(document.querySelector(".bsd-message").textContent, message);
    assert.equal(document.querySelector(".bsd-path"), null);
    assert.equal(document.querySelector(".bsd-progress").hidden, true);
  }
  Object.assign(state, {
    phase: "error",
    result: null,
    message: '探索中断：<img src=x onerror="alert(1)">',
    warning: "缓存保存失败，本次探索使用网络数据。",
  });
  render(state);
  assert.equal(document.querySelector(".bsd-message img"), null);
  assert.equal(
    document.querySelector(".bsd-message").textContent,
    state.message,
  );
  assert.equal(document.querySelector(".bsd-warning").hidden, false);
  for (const error of [
    "toString",
    "__proto__",
    '<img src=x onerror="alert(1)">',
  ]) {
    state.endpoints[1].error = { code: "unknown", message: error };
    render(state);
    assert.equal(
      document.querySelector(".bsd-hint").textContent,
      `获取终点用户时出错：${error}`,
    );
    assert.equal(document.querySelector(".bsd-hint img"), null);
  }
  for (const [code, expected] of [
    ["invalid-input", "请输入有效的终点用户标识"],
    ["profile-identity", "无法识别终点用户"],
    ["profile-missing", "无法识别终点用户，请检查原站页面"],
    ["network", "暂时无法获取终点用户，请稍后重试"],
    ["timeout", "获取终点用户超时，请稍后重试"],
  ]) {
    state.endpoints[1].error = { code, message: "任意变更的底层消息" };
    render(state);
    assert.equal(document.querySelector(".bsd-hint").textContent, expected);
  }
  env.window.close();
});
