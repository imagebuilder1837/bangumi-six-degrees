import { styles } from "./styles.mjs";
import { mountModePicker } from "./mode-picker.mjs";
import { layoutPath } from "./path-layout.mjs";

const defaultAvatar = "https://lain.bgm.tv/pic/user/l/icon.jpg";
const modeNames = {
  mutual: "双向好友",
  directed: "单向好友",
  undirected: "无向关联",
};
const modeNotes = {
  mutual: "每一步，双方都添加了对方",
  directed: "沿起点 → 终点的好友关系前进",
  undirected: "每一步，任意一方添加对方即可",
};
function image(element, url) {
  const src = url || defaultAvatar;
  if (element.getAttribute("src") === src) return;
  element.onerror = () => {
    element.onerror = null;
    element.src = defaultAvatar;
  };
  element.src = src;
}
function text(element, value) {
  if (element.textContent !== value) element.textContent = value;
}
function endpointError(error, index) {
  const user = `${index === 0 ? "起点" : "终点"}用户`;
  const messages = {
    "input-required": `请先填入${user}标识`,
    "invalid-input": `请输入有效的${user}标识`,
    "profile-missing": `无法识别${user}，请检查原站页面`,
    "profile-identity": `无法识别${user}`,
    timeout: `获取${user}超时，请稍后重试`,
    network: `暂时无法获取${user}，请稍后重试`,
  };
  return Object.hasOwn(messages, error.code)
    ? messages[error.code]
    : `获取${user}时出错：${error.message}`;
}
function status(state) {
  const result = state.result;
  const mode = modeNames[result?.conditions.mode ?? state.mode];
  if (result) {
    const restrictions = result.conditions.excluded?.length
      ? "与当前排除条件"
      : "";
    return {
      found: [
        "已确认最短路径",
        `${mode} · 结论基于本次关系数据${restrictions}`,
      ],
      unreachable: [
        "探索完成",
        `结论基于本次关系数据与「${mode}」模式${restrictions}。`,
      ],
      incomplete: ["路径待确认", "可以重新探索，或调整关系模式。"],
      invalid: ["调整用户", "请调整起点或终点用户后重新探索。"],
    }[result.status];
  }
  return {
    idle: ["等待探索", "填入用户标识，或试试随机班友。"],
    resolving: ["确认用户", "确认完成后开始探索好友关系。"],
    running: ["正在探索", ""],
    stopped: ["已停止", "已获取的有效关系缓存保留，可重新探索。"],
    error: ["探索结束", "调整输入或稍后重新探索。"],
  }[state.phase];
}
export function mountView(window, session, { self, services }) {
  const { document } = window;
  const style = document.createElement("style");
  style.textContent = styles;
  document.head.append(style);
  const entry = document.createElement("li");
  entry.id = "bangumi-six-degrees-entry";
  const badge = document.createElement("span");
  badge.className = "service";
  badge.style.backgroundColor = "#7756A8";
  badge.style.color = "#fff";
  badge.textContent = "SixDegrees";
  const launcher = document.createElement("a");
  launcher.href = "#";
  launcher.className = "l bsd-entry-link";
  launcher.setAttribute("aria-label", "六度分隔");
  launcher.setAttribute("aria-haspopup", "dialog");
  launcher.textContent = "六度分隔";
  entry.append(badge, document.createTextNode(" "), launcher);
  services.append(entry);
  const overlay = document.createElement("div");
  overlay.className = "bsd-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<section class="bsd-dialog" role="dialog" aria-modal="true" aria-labelledby="bsd-title" hidden>
    <header class="bsd-header"><div><h2 id="bsd-title">六度分隔</h2><small>你与 TA，相隔几跳？</small></div><button type="button" class="bsd-close" aria-label="关闭六度分隔"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 6 12 12M6 18 18 6"/></svg></button></header>
    <div class="bsd-body"><div class="bsd-workspace"><div class="bsd-top">
      ${endpoint("起点用户", 0)}
      <button type="button" class="bsd-swap" data-action="swap" aria-label="交换起点与终点">⇄</button>
      ${endpoint("终点用户", 1)}
    </div><div class="bsd-mode"><div class="bsd-mode-choice"><button type="button" class="bsd-mode-trigger" aria-label="关系模式"></button><span class="bsd-mode-note"></span></div><button type="button" class="bsd-exclusions-toggle" data-action="toggle-exclusions" aria-expanded="false" aria-controls="bsd-exclusions">排除中转</button></div>
    <section id="bsd-exclusions" class="bsd-exclusions" aria-label="排除中转名单" hidden>
      <p class="bsd-exclusions-note">以下班友不会作为中转，仍可作为起点或终点。</p>
      <div class="bsd-exclusions-entry"><label class="bsd-exclusions-input"><span>@</span><input aria-label="排除中转的用户标识" aria-describedby="bsd-exclusions-feedback" placeholder="请输入用户标识" autocomplete="off" spellcheck="false"></label><button type="button" data-action="add-excluded">添加</button><button type="button" data-action="cancel-excluded" hidden>取消</button></div>
      <p id="bsd-exclusions-feedback" class="bsd-exclusions-feedback" role="status"></p><p class="bsd-exclusions-warning" role="status" hidden></p>
      <p class="bsd-exclusions-empty">暂未排除班友。</p><ul class="bsd-exclusions-list"></ul>
    </section>
    <div class="bsd-results"><div class="bsd-idle-mark" aria-hidden="true"><i></i><i></i><i></i></div><div role="status"><span class="bsd-status-label"></span><h3 class="bsd-message"></h3><p class="bsd-detail"></p></div><div class="bsd-progress"></div><div class="bsd-pulse" aria-hidden="true" hidden><i></i><i></i><i></i></div><div class="bsd-output"></div><p class="bsd-warning" role="status" hidden></p></div>
    <section class="bsd-history" aria-labelledby="bsd-history-title" hidden><header><h3 id="bsd-history-title">最近探索</h3><button type="button" data-action="clear-history">清空记录</button></header><ul class="bsd-history-list"></ul></section></div></div>
    <footer class="bsd-footer"><span id="bsd-hint" class="bsd-hint" role="status"></span><div class="bsd-actions"><button type="button" data-action="stop" hidden>停止探索</button><button type="button" data-action="explore">开始探索 ↗</button></div></footer>
  </section>`;
  function endpoint(label, index) {
    return `<div class="bsd-endpoint" data-endpoint="${index}"><a class="bsd-avatar-link" target="_blank" rel="noopener noreferrer"><img class="bsd-avatar" alt=""></a><div class="bsd-endpoint-info"><span class="bsd-endpoint-label">${label}</span><strong class="bsd-endpoint-name bsd-user-name"></strong><span class="bsd-endpoint-placeholder">选择一位班友</span><label class="bsd-input"><span>@</span><input aria-label="${label}" aria-describedby="bsd-hint" placeholder="请输入用户标识" autocomplete="off" spellcheck="false"></label><div class="bsd-shortcuts"><button type="button" data-fill="self" title="填入自己">填入自己</button><button type="button" data-action="random" aria-label="随机班友">随机班友</button></div></div></div>`;
  }
  document.body.append(overlay);
  const dialog = overlay.querySelector('[role="dialog"]');
  const modeTrigger = overlay.querySelector(".bsd-mode-trigger");
  const modePicker = mountModePicker(
    window,
    overlay,
    modeTrigger,
    modeNames,
    (mode) => session.setMode(mode),
  );
  const explore = overlay.querySelector('[data-action="explore"]');
  const stop = overlay.querySelector('[data-action="stop"]');
  const endpoints = [...overlay.querySelectorAll(".bsd-endpoint")];
  const exclusionsToggle = overlay.querySelector(
    '[data-action="toggle-exclusions"]',
  );
  const exclusionsPanel = overlay.querySelector(".bsd-exclusions");
  const excludedInput = exclusionsPanel.querySelector("input");
  const addExcluded = exclusionsPanel.querySelector(
    '[data-action="add-excluded"]',
  );
  const cancelExcluded = exclusionsPanel.querySelector(
    '[data-action="cancel-excluded"]',
  );
  const excludedRows = new Map();
  function toggleExclusions(expanded) {
    exclusionsToggle.setAttribute("aria-expanded", String(expanded));
    exclusionsPanel.hidden = !expanded;
    if (!expanded && exclusionsPanel.contains(document.activeElement))
      exclusionsToggle.focus({ preventScroll: true });
  }
  exclusionsToggle.addEventListener("click", () =>
    toggleExclusions(exclusionsPanel.hidden),
  );
  excludedInput.addEventListener("input", () =>
    session.setExcludedInput(excludedInput.value),
  );
  excludedInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    if (!event.repeat) void session.addExcluded();
  });
  addExcluded.addEventListener("click", () => void session.addExcluded());
  cancelExcluded.addEventListener("click", () => session.cancelExcluded());
  function renderExclusions(state, busy) {
    const exclusions = state.exclusions;
    if (excludedInput.value !== exclusions.input)
      excludedInput.value = exclusions.input;
    excludedInput.disabled = busy;
    const resolving = exclusions.activity === "resolving";
    addExcluded.disabled = busy || resolving || !exclusions.input.trim();
    cancelExcluded.hidden = !resolving;
    text(addExcluded, resolving ? "确认中…" : "添加");
    text(
      exclusionsPanel.querySelector(".bsd-exclusions-feedback"),
      exclusions.message,
    );
    const warning = exclusionsPanel.querySelector(".bsd-exclusions-warning");
    text(warning, exclusions.cacheWarning);
    warning.hidden = !warning.textContent;
    exclusionsPanel.querySelector(".bsd-exclusions-empty").hidden =
      !!exclusions.users.length;
    const ids = new Set(exclusions.users.map(({ id }) => id));
    for (const [id, row] of excludedRows) {
      if (ids.has(id)) continue;
      row.remove();
      excludedRows.delete(id);
    }
    for (const user of exclusions.users) {
      let row = excludedRows.get(user.id);
      if (!row) {
        row = document.createElement("li");
        row.className = "bsd-excluded-user";
        row.innerHTML =
          '<a class="bsd-avatar-link" target="_blank" rel="noopener noreferrer"><img alt=""></a><div><strong class="bsd-user-name"></strong><small class="bsd-user-id"></small></div><button type="button">移除</button>';
        const profile = row.querySelector("a");
        profile.href = `/user/${encodeURIComponent(user.id)}`;
        profile.setAttribute("aria-label", `打开 @${user.id} 的主页`);
        const remove = row.querySelector("button");
        remove.dataset.remove = user.id;
        remove.setAttribute("aria-label", `移除 @${user.id}`);
        remove.addEventListener("click", () => session.removeExcluded(user.id));
        excludedRows.set(user.id, row);
        exclusionsPanel.querySelector("ul").append(row);
      }
      image(row.querySelector("img"), user.avatar);
      text(row.querySelector("strong"), user.name || user.id);
      row.querySelector("strong").title = user.name || user.id;
      text(row.querySelector("small"), `@${user.id}`);
      row.querySelector("button").disabled = busy;
    }
  }
  const historySection = overlay.querySelector(".bsd-history");
  historySection
    .querySelector('[data-action="clear-history"]')
    .addEventListener("click", () => {
      if (
        window.confirm(
          "清空全部最近探索记录？此操作不会清除当前结果或共享缓存。",
        )
      )
        session.clearHistory();
    });
  const historyList = historySection.querySelector("ul");
  const historyRows = new Map();
  function renderHistory(history) {
    historySection.hidden = !history.entries.length;
    const key = ({ start, end, mode }) => JSON.stringify([start, end, mode]);
    const keys = new Set(history.entries.map(key));
    for (const [id, row] of historyRows) {
      if (keys.has(id)) continue;
      row.remove();
      historyRows.delete(id);
    }
    let previous = null;
    for (const entry of history.entries) {
      const id = key(entry);
      let row = historyRows.get(id);
      if (!row) {
        row = document.createElement("li");
        row.className = "bsd-history-row";
        row.innerHTML =
          '<div class="bsd-history-main"><div class="bsd-history-pair" role="group" aria-label="探索端点，按起点至终点排列"></div><div class="bsd-history-summary"><span class="bsd-history-result"></span><small class="bsd-history-mode"></small></div></div><small class="bsd-history-meta"><span class="bsd-history-restriction"></span><time></time></small>';
        const pair = row.querySelector(".bsd-history-pair");
        for (const [index, userId] of [entry.start, entry.end].entries()) {
          if (index) {
            const arrow = document.createElementNS(
              "http://www.w3.org/2000/svg",
              "svg",
            );
            arrow.classList.add("bsd-history-arrow");
            arrow.setAttribute("viewBox", "0 0 16 16");
            arrow.setAttribute("aria-hidden", "true");
            arrow.setAttribute("focusable", "false");
            arrow.innerHTML =
              '<path d="M3 8h10m-4-4 4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>';
            pair.append(arrow);
          }
          const user = document.createElement("div");
          user.className = "bsd-history-user";
          user.innerHTML =
            '<a class="bsd-avatar-link" target="_blank" rel="noopener noreferrer"><img alt=""></a><div><strong class="bsd-user-name"></strong><small class="bsd-user-id"></small></div>';
          const link = user.querySelector("a");
          link.href = `/user/${encodeURIComponent(userId)}`;
          link.setAttribute("aria-label", `打开 @${userId} 的主页`);
          text(user.querySelector("small"), `@${userId}`);
          pair.append(user);
        }
        historyRows.set(id, row);
      }
      const next = previous
        ? previous.nextElementSibling
        : historyList.firstElementChild;
      if (next !== row) {
        const focused = row.contains(document.activeElement)
          ? document.activeElement
          : null;
        historyList.insertBefore(row, next);
        // Moving an existing row can blur its link; restore without scrolling.
        if (focused && document.activeElement !== focused)
          focused.focus({ preventScroll: true });
      }
      previous = row;
      row.querySelectorAll(".bsd-history-user").forEach((element, index) => {
        const userId = index === 0 ? entry.start : entry.end;
        const profile = Object.hasOwn(history.users, userId)
          ? history.users[userId]
          : {};
        const name = element.querySelector("strong");
        text(name, profile.name || userId);
        name.title = name.textContent;
        image(element.querySelector("img"), profile.avatar);
      });
      const result = row.querySelector(".bsd-history-result");
      if (entry.status === "found") {
        const count = document.createElement("span");
        count.className = "bsd-history-hops";
        count.textContent = String(entry.hops);
        result.replaceChildren(count, " 跳");
      } else text(result, "不可达");
      text(
        row.querySelector(".bsd-history-mode"),
        `· ${modeNames[entry.mode]}`,
      );
      const restriction = row.querySelector(".bsd-history-restriction");
      restriction.hidden = !entry.hasExclusions;
      text(restriction, entry.hasExclusions ? "含排除条件 ·" : "");
      const date = new Date(entry.completedAt);
      const time = row.querySelector("time");
      time.dateTime = date.toISOString();
      text(
        time,
        date.toLocaleString("zh-CN", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
      );
      time.title = date.toLocaleString();
    }
  }
  const message = overlay.querySelector(".bsd-message");
  const output = overlay.querySelector(".bsd-output");
  function inputMode(mode) {
    overlay.dataset.focus = mode;
    launcher.dataset.focus = mode;
  }
  inputMode("pointer");
  const inComponent = (target) =>
    overlay.contains(target) || entry.contains(target);
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (inComponent(event.target)) inputMode("pointer");
    },
    true,
  );
  let inputEnterHeld = false;
  document.addEventListener("keyup", (event) => {
    if (event.key === "Enter") inputEnterHeld = false;
  });
  window.addEventListener("blur", () => {
    inputEnterHeld = false;
  });
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.isComposing) return;
      if (event.key === "Escape" && session.state.visible) {
        event.preventDefault();
        inputMode("keyboard");
        if (modePicker.expanded) {
          modePicker.close();
          modeTrigger.focus({ preventScroll: true });
        } else if (!exclusionsPanel.hidden) {
          toggleExclusions(false);
          exclusionsToggle.focus({ preventScroll: true });
        } else close();
        return;
      }
      // Holding Enter must not activate another control after the input blurs.
      if (event.key === "Enter" && event.repeat && inputEnterHeld) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Tab") {
        inputMode("keyboard");
        return;
      }
      if (!inComponent(event.target)) return;
      if (
        event.key === "Escape" ||
        (event.key === "Enter" &&
          !event.target.closest("input,textarea,[contenteditable]")) ||
        (!event.target.closest("input,textarea,[contenteditable]") &&
          [
            " ",
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
            "Home",
            "End",
          ].includes(event.key))
      )
        inputMode("keyboard");
    },
    true,
  );
  endpoints.forEach((element, index) => {
    const input = element.querySelector("input");
    input.addEventListener("input", () => session.setInput(index, input.value));
    input.addEventListener("blur", () => {
      if (session.state.canEdit) void session.resolve(index);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        if (event.repeat) return;
        inputEnterHeld = true;
        input.blur();
      }
    });
    element
      .querySelector('[data-fill="self"]')
      .addEventListener("click", () => void session.fill(index, self));
    element
      .querySelector('[data-action="random"]')
      .addEventListener("click", () => void session.random(index));
  });
  overlay
    .querySelector('[data-action="swap"]')
    .addEventListener("click", () => session.swap());
  explore.addEventListener("click", () => void session.run());
  stop.addEventListener("click", () => session.stop());
  const close = () => {
    modePicker.close();
    session.close();
    launcher.focus();
  };
  overlay.querySelector(".bsd-close").addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  overlay.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = [
      ...dialog.querySelectorAll(
        "button:not(:disabled):not([hidden]),input:not(:disabled),select:not(:disabled),a[href]",
      ),
    ].filter((element) => !element.closest("[hidden]"));
    const first = focusable[0],
      last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });
  launcher.addEventListener("click", (event) => {
    event.preventDefault();
    session.open();
    const empty = endpoints.find(
      (element) => !element.querySelector("input").value,
    );
    (
      empty?.querySelector("input:not(:disabled)") ??
      dialog.querySelector("input:not(:disabled)") ??
      (!stop.hidden ? stop : dialog.querySelector("button"))
    )?.focus();
  });
  let pathLayout;
  function renderResult(result) {
    pathLayout?.destroy();
    pathLayout = null;
    output.replaceChildren();
    delete output.dataset.result;
    if (!result) return;
    output.dataset.result = result.status;
    if (result.status !== "found") return;
    const path = document.createElement("div");
    path.className = "bsd-path";
    path.setAttribute("role", "group");
    path.setAttribute("aria-label", "已确认的最短关系路径，按起点到终点排列");
    const relations = result.relations.map((relation, index) => {
      const from = `@${result.path[index].id}`;
      const to = `@${result.path[index + 1].id}`;
      return {
        ...relation,
        description:
          relation.forward && relation.reverse
            ? `${from} 与 ${to} 互相添加为好友`
            : relation.forward
              ? `${from} 将 ${to} 添加为好友`
              : `${to} 将 ${from} 添加为好友`,
      };
    });
    result.path.forEach((user, index) => {
      const node = document.createElement("div");
      node.className = "bsd-path-user";
      node.style.setProperty("--bsd-step", Math.min(index, 7));
      const link = document.createElement("a");
      link.className = "bsd-avatar-link";
      link.setAttribute("aria-label", `打开 @${user.id} 的主页`);
      link.href = `/user/${encodeURIComponent(user.id)}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const avatar = document.createElement("img");
      avatar.alt = "";
      image(avatar, user.avatar);
      const name = document.createElement("strong");
      name.className = "bsd-user-name";
      name.textContent = user.name || user.id;
      name.title = name.textContent;
      const id = document.createElement("small");
      id.className = "bsd-user-id";
      id.textContent = `@${user.id}`;
      link.append(avatar);
      node.append(link, name, id);
      if (index === 0 || index === result.path.length - 1) {
        const label = document.createElement("span");
        label.className = "bsd-path-endpoint";
        label.textContent =
          result.path.length === 1
            ? "起点 / 终点"
            : index === 0
              ? "起点"
              : "终点";
        node.append(label);
      }
      path.append(node);
      if (relations[index]) {
        const description = document.createElement("span");
        description.id = `bsd-path-relation-${index}`;
        // Direct aria-describedby references expose hidden text without a
        // duplicate stop in reading order or an extra grid item.
        description.hidden = true;
        description.textContent = relations[index].description;
        link.setAttribute("aria-describedby", description.id);
        path.append(description);
      }
    });
    output.append(path);
    pathLayout = layoutPath(window, path, relations);
    if (result.path.length > 7) {
      const egg = document.createElement("p");
      egg.className = "bsd-egg";
      egg.textContent = "六度之外，还有班友。";
      output.append(egg);
    }
  }
  let lastResult;
  session.subscribe((state) => {
    const active = document.activeElement;
    const hadFocus = dialog.contains(active);
    overlay.hidden = !state.visible;
    dialog.hidden = !state.visible;
    const busy = !state.canEdit;
    renderExclusions(state, busy);
    renderHistory(state.history);
    const randomizing = state.endpoints.some(
      ({ activity }) => activity === "randomizing",
    );
    endpoints.forEach((element, index) => {
      const item = state.endpoints[index];
      const input = element.querySelector("input");
      if (input.value !== item.input) input.value = item.input;
      input.disabled = busy;
      input.setAttribute("aria-invalid", String(!!item.error));
      element.dataset.randomizing = String(item.activity === "randomizing");
      const user = item.user;
      const name = element.querySelector(".bsd-endpoint-name");
      text(name, user?.name || user?.id || "");
      name.title = name.textContent;
      name.hidden = !user;
      element.querySelector(".bsd-endpoint-placeholder").hidden = !!user;
      image(element.querySelector("img"), user?.avatar);
      const profile = element.querySelector(".bsd-avatar-link");
      if (user) {
        profile.href = `/user/${encodeURIComponent(user.id)}`;
        profile.setAttribute("aria-label", `打开 @${user.id} 的主页`);
      } else {
        profile.removeAttribute("href");
        profile.removeAttribute("aria-label");
      }
      const selfButton = element.querySelector('[data-fill="self"]');
      selfButton.disabled = busy || !self;
      selfButton.title = self ? "填入自己" : "无法识别登录用户";
      const randomButton = element.querySelector('[data-action="random"]');
      randomButton.disabled = busy;
      randomButton.setAttribute(
        "aria-busy",
        String(item.activity === "randomizing"),
      );
    });
    modePicker.update(state.mode, busy, state.visible);
    text(overlay.querySelector(".bsd-mode-note"), modeNotes[state.mode]);
    overlay.querySelector('[data-action="swap"]').disabled = busy;
    explore.disabled = !state.canRun;
    text(explore, busy ? "探索中…" : "开始探索 ↗");
    stop.hidden = !state.canStop;
    text(
      stop,
      randomizing
        ? "停止抽取"
        : state.exclusions.activity === "resolving"
          ? "取消添加"
          : "停止探索",
    );
    const [label, detail] = status(state);
    text(overlay.querySelector(".bsd-status-label"), label);
    text(overlay.querySelector(".bsd-detail"), detail);
    if (state.result?.status === "found") {
      if (lastResult !== state.result) {
        const hops = state.result.path.length - 1;
        const count = document.createElement("span");
        count.className = "bsd-hop-count";
        count.textContent = String(hops);
        message.replaceChildren(
          hops === 0 ? "同一位班友，" : "相隔 ",
          count,
          hops === 0 ? " 跳。" : " 跳",
        );
      }
    } else text(message, state.message);
    const running = state.phase === "running";
    const progress = overlay.querySelector(".bsd-progress");
    progress.hidden = !running;
    text(
      progress,
      running
        ? `已触达 ${state.progress.visited} 位用户 · 已读取 ${state.progress.observations} 份关系列表`
        : "",
    );
    overlay.querySelector(".bsd-pulse").hidden = !running;
    overlay.querySelector(".bsd-idle-mark").hidden = state.phase !== "idle";
    const warning = overlay.querySelector(".bsd-warning");
    text(warning, state.warning);
    warning.hidden = !state.warning;
    const hints = state.endpoints.flatMap(({ error }, index) =>
      error ? [endpointError(error, index)] : [],
    );
    if (state.exclusions.storageWarning)
      hints.push(state.exclusions.storageWarning);
    for (const warning of [
      state.history.storageWarning,
      state.history.cacheWarning,
    ])
      if (warning) hints.push(warning);
    if (randomizing) hints.push("正在抽取班友…");
    const resolving = state.endpoints.flatMap(({ activity }, index) =>
      activity === "resolving" ? [index === 0 ? "起点用户" : "终点用户"] : [],
    );
    if (resolving.length) hints.push(`正在确认${resolving.join("和")}…`);
    text(overlay.querySelector(".bsd-hint"), hints.join("；"));
    if (lastResult !== state.result) {
      renderResult(state.result);
      lastResult = state.result;
    }
    if (state.visible) pathLayout?.update();
    if (
      state.visible &&
      hadFocus &&
      (!active.isConnected || active.disabled || active.closest("[hidden]"))
    )
      (stop.hidden ? explore : stop).focus({ preventScroll: true });
  });
  return launcher;
}
