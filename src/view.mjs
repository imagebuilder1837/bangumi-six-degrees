import { styles } from "./styles.mjs";

const defaultAvatar = "https://lain.bgm.tv/pic/user/l/icon.jpg";
const arrows = { undirected: "—", directed: "→", mutual: "↔" };
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
    return {
      found: ["已确认最短路径", `${mode} · 结论基于本次关系数据`],
      unreachable: ["探索完成", `结论基于本次关系数据与「${mode}」模式。`],
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
    </div><div class="bsd-mode"><select aria-label="关系模式"><option value="mutual">双向好友</option><option value="directed">单向好友</option><option value="undirected">无向关联</option></select><span class="bsd-mode-note"></span></div>
    <div class="bsd-results"><div class="bsd-idle-mark" aria-hidden="true"><i></i><i></i><i></i></div><div role="status"><span class="bsd-status-label"></span><h3 class="bsd-message"></h3><p class="bsd-detail"></p></div><div class="bsd-progress"></div><div class="bsd-pulse" aria-hidden="true" hidden><i></i><i></i><i></i></div><div class="bsd-output"></div><p class="bsd-warning" role="status" hidden></p></div></div></div>
    <footer class="bsd-footer"><span id="bsd-hint" class="bsd-hint" role="status"></span><div class="bsd-actions"><button type="button" data-action="stop" hidden>停止探索</button><button type="button" data-action="explore">开始探索 ↗</button></div></footer>
  </section>`;
  function endpoint(label, index) {
    return `<div class="bsd-endpoint" data-endpoint="${index}"><a class="bsd-avatar-link" target="_blank" rel="noopener noreferrer"><img class="bsd-avatar" alt=""></a><div class="bsd-endpoint-info"><span class="bsd-endpoint-label">${label}</span><strong class="bsd-endpoint-name"></strong><span class="bsd-endpoint-placeholder">选择一位班友</span><label class="bsd-input"><span>@</span><input aria-label="${label}" aria-describedby="bsd-hint" placeholder="请输入用户标识" autocomplete="off" spellcheck="false"></label><div class="bsd-shortcuts"><button type="button" data-fill="self" title="填入自己">填入自己</button><button type="button" data-action="random" aria-label="随机班友">随机班友</button></div></div></div>`;
  }
  document.body.append(overlay);
  const dialog = overlay.querySelector('[role="dialog"]');
  const select = overlay.querySelector("select");
  const explore = overlay.querySelector('[data-action="explore"]');
  const stop = overlay.querySelector('[data-action="stop"]');
  const endpoints = [...overlay.querySelectorAll(".bsd-endpoint")];
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
        close();
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
    input.addEventListener("focus", () => input.select());
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
  select.addEventListener("change", () => session.setMode(select.value));
  overlay
    .querySelector('[data-action="swap"]')
    .addEventListener("click", () => session.swap());
  explore.addEventListener("click", () => void session.run());
  stop.addEventListener("click", () => session.stop());
  const close = () => {
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
    ];
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
  function renderResult(result) {
    output.replaceChildren();
    delete output.dataset.result;
    if (!result) return;
    output.dataset.result = result.status;
    if (result.status !== "found") return;
    const path = document.createElement("div");
    path.className = "bsd-path";
    path.setAttribute("aria-label", "已确认的最短关系路径");
    result.path.forEach((user, index) => {
      if (index) {
        const arrow = document.createElement("span");
        arrow.className = "bsd-link";
        arrow.textContent = arrows[result.conditions.mode];
        arrow.setAttribute("aria-hidden", "true");
        path.append(arrow);
      }
      const link = document.createElement("a");
      link.href = `/user/${encodeURIComponent(user.id)}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.style.setProperty("--bsd-step", Math.min(index, 7));
      const avatar = document.createElement("img");
      avatar.alt = "";
      image(avatar, user.avatar);
      const name = document.createElement("strong");
      name.textContent = user.name || user.id;
      name.title = name.textContent;
      const id = document.createElement("small");
      id.textContent = `@${user.id}`;
      link.append(avatar, name, id);
      path.append(link);
    });
    output.append(path);
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
    select.value = state.mode;
    select.disabled = busy;
    text(overlay.querySelector(".bsd-mode-note"), modeNotes[state.mode]);
    overlay.querySelector('[data-action="swap"]').disabled = busy;
    explore.disabled = !state.canRun;
    text(explore, busy ? "探索中…" : "开始探索 ↗");
    stop.hidden = !state.canStop;
    text(stop, randomizing ? "停止抽取" : "停止探索");
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
    if (
      state.visible &&
      hadFocus &&
      (!active.isConnected || active.disabled || active.closest("[hidden]"))
    )
      (stop.hidden ? explore : stop).focus({ preventScroll: true });
  });
  return launcher;
}
