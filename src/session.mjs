import { search } from "./search.mjs";
import { createDataSource } from "./data.mjs";

const memoryKey = "bangumi-six-degrees:last-success";
const modes = ["undirected", "directed", "mutual"];
function readMemory(storage) {
  try {
    const value = JSON.parse(storage()?.getItem(memoryKey) ?? "null");
    if (
      value &&
      [value.start, value.end].every(
        (id) => typeof id === "string" && id && !/[\s/?#@]/u.test(id),
      ) &&
      modes.includes(value.mode)
    )
      return value;
  } catch {
    /* Storage denial or malformed data does not prevent opening. */
  }
}
export function createSession({ site, store, storage, now = Date.now }) {
  const state = {
    visible: false,
    phase: "idle",
    kind: null,
    mode: "undirected",
    inputs: ["", ""],
    endpoints: [null, null],
    errors: ["", ""],
    resolving: [false, false],
    result: null,
    stale: false,
    message: "选两位班友，看看彼此隔着几次相遇。",
    progress: { visited: 0, observations: 0 },
    requests: 0,
    warning: "",
  };
  const listeners = new Set();
  const emit = () => {
    for (const listener of listeners) listener(state);
  };
  const busy = () => ["resolving", "running"].includes(state.phase);
  const versions = [0, 0],
    resolving = [null, null],
    promises = [null, null];
  let opened = false,
    controller,
    baseline = 0;
  const warn = (text) => {
    state.warning = text;
    emit();
  };
  function setInput(index, value) {
    if (busy()) return;
    versions[index]++;
    resolving[index]?.abort();
    promises[index] = null;
    state.resolving[index] = false;
    state.inputs[index] = value;
    state.endpoints[index] = null;
    state.errors[index] = "";
    state.stale = !!state.result;
    emit();
  }
  function resolve(index) {
    if (promises[index]) return promises[index];
    const input = state.inputs[index];
    if (!input.trim()) return Promise.resolve();
    const version = ++versions[index];
    const abort = new AbortController();
    resolving[index] = abort;
    state.resolving[index] = true;
    state.errors[index] = "";
    emit();
    const promise = (async () => {
      try {
        const user = await site.resolve(input, { signal: abort.signal });
        if (versions[index] !== version) return;
        state.inputs[index] = user.id;
        state.endpoints[index] = { ...user, fetchedAt: now() };
      } catch (error) {
        if (versions[index] === version && !abort.signal.aborted) {
          state.errors[index] = error.message;
          state.endpoints[index] = null;
        }
      } finally {
        if (versions[index] === version) {
          state.resolving[index] = false;
          promises[index] = null;
          emit();
        }
      }
    })();
    promises[index] = promise;
    return promise;
  }
  async function execute(kind, conditions, abort) {
    baseline = state.requests;
    state.phase = "running";
    state.kind = kind;
    state.warning = "";
    state.stale = !!state.result;
    state.progress = { visited: 0, observations: 0 };
    state.message =
      kind === "cache"
        ? "正在确认缓存能否证明最短路径…"
        : "沿着好友关系，寻找最短的相遇路线…";
    emit();
    const source = createDataSource({
      kind,
      store,
      site,
      initialUsers: kind === "network" ? state.endpoints.filter(Boolean) : [],
      onWarning: (text) => {
        if (controller === abort && !abort.signal.aborted) warn(text);
      },
    });
    try {
      if (kind === "cache") {
        try {
          const profiles = await source.users(
            [conditions.start, conditions.end],
            { signal: abort.signal },
          );
          abort.signal.throwIfAborted();
          state.endpoints = [
            profiles.get(conditions.start),
            profiles.get(conditions.end),
          ];
          emit();
        } catch (error) {
          abort.signal.throwIfAborted();
          warn(`用户资料缓存不可用：${error.message}`);
        }
      }
      const result = await search({
        ...conditions,
        source,
        signal: abort.signal,
        onProgress: (progress) => {
          if (controller === abort && !abort.signal.aborted) {
            state.progress = progress;
            emit();
          }
        },
      });
      abort.signal.throwIfAborted();
      if (result.status === "found") {
        let users;
        try {
          users = await source.users(result.path, { signal: abort.signal });
        } catch (error) {
          abort.signal.throwIfAborted();
          warn(`资料读取失败：${error.message}`);
          users = new Map();
        }
        abort.signal.throwIfAborted();
        state.result = {
          status: "found",
          kind,
          conditions,
          path: result.path.map(
            (id) => users.get(id) ?? { id, name: id, avatar: "" },
          ),
        };
        state.message = `${kind === "cache" ? "缓存已证明" : "已确认"}最短路径 · ${result.path.length - 1} 跳`;
        try {
          storage()?.setItem(memoryKey, JSON.stringify(conditions));
        } catch {
          warn("无法记忆本次选择；搜索结果不受影响");
        }
      } else {
        state.result = { ...result, kind, conditions };
        state.message = {
          unreachable: "此关系模式下没有可达路径。",
          incomplete: "缓存不足以证明最短路径，点击探索获取最新关系。",
          invalid: "端点属于已识别的原站无效节点，请换一位班友。",
        }[result.status];
      }
      state.stale = false;
      state.phase = "complete";
    } catch (error) {
      if (controller !== abort) return;
      const stopped = abort.signal.aborted;
      if (!stopped) abort.abort(error);
      state.phase = stopped ? "stopped" : "error";
      state.message = stopped
        ? "已停止。已获取的有效关系缓存保留。"
        : `${kind === "cache" ? "缓存不可用，不会自动联网探索" : "本次未能确定路径"}：${error.message}`;
    } finally {
      if (controller === abort) {
        controller = undefined;
        emit();
      }
    }
  }
  const session = {
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    setInput,
    resolve,
    async open() {
      state.visible = true;
      emit();
      if (opened) return;
      opened = true;
      const previous = readMemory(storage);
      if (!previous) return;
      state.inputs = [previous.start, previous.end];
      state.mode = previous.mode;
      state.endpoints = state.inputs.map((id) => ({
        id,
        name: id,
        avatar: "",
      }));
      controller = new AbortController();
      await execute("cache", previous, controller);
    },
    close() {
      state.visible = false;
      emit();
    },
    setMode(mode) {
      if (!busy() && modes.includes(mode)) {
        state.mode = mode;
        state.stale = !!state.result;
        emit();
      }
    },
    swap() {
      if (busy()) return;
      for (let index = 0; index < 2; index++) {
        versions[index]++;
        resolving[index]?.abort();
        promises[index] = null;
      }
      state.inputs.reverse();
      state.endpoints.reverse();
      state.errors.reverse();
      state.resolving = [false, false];
      state.stale = !!state.result;
      emit();
    },
    async fill(index, id) {
      if (!id || busy()) return;
      setInput(index, id);
      await resolve(index);
    },
    async run() {
      if (busy()) return;
      if (state.inputs.some((value) => !value.trim())) {
        state.errors = state.inputs.map((value) =>
          value.trim() ? "" : "请先填入用户",
        );
        emit();
        return;
      }
      const abort = new AbortController();
      controller = abort;
      state.phase = "resolving";
      state.message = "正在确认两个端点…";
      emit();
      await Promise.all(
        [0, 1].map((index) =>
          state.endpoints[index] ? undefined : resolve(index),
        ),
      );
      if (abort.signal.aborted) return;
      if (state.endpoints.some((user) => !user)) {
        state.phase = "error";
        state.message = "请先修正用户输入。";
        controller = undefined;
        emit();
        return;
      }
      await execute(
        "network",
        {
          start: state.endpoints[0].id,
          end: state.endpoints[1].id,
          mode: state.mode,
        },
        abort,
      );
    },
    stop() {
      if (!busy()) return;
      controller?.abort(new DOMException("用户停止探索", "AbortError"));
      for (let index = 0; index < 2; index++) {
        versions[index]++;
        resolving[index]?.abort();
        promises[index] = null;
        state.resolving[index] = false;
      }
      state.phase = "stopped";
      state.message = "已停止。已获取的有效关系缓存保留。";
      emit();
    },
    countRequests(count) {
      state.requests = count;
      emit();
    },
    requestCount() {
      return state.requests - baseline;
    },
  };
  return session;
}
