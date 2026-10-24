import { search } from "./search.mjs";
import { createDataSource } from "./data.mjs";
import { normalizeInput } from "./site.mjs";

const modes = ["mutual", "directed", "undirected"];
const initialMessage = "选两位班友，看看彼此隔着几次相遇。";
export function createSession({
  site,
  store,
  storage,
  current,
  randomUsers,
  now = Date.now,
}) {
  try {
    storage?.()?.removeItem("bangumi-six-degrees:last-success");
  } catch {
    // Storage denial must not prevent opening or network searches.
  }
  const state = {
    visible: false,
    phase: "idle",
    mode: "mutual",
    inputs: [current?.id ?? "", ""],
    endpoints: [current ? { ...current, fetchedAt: now() } : null, null],
    errors: ["", ""],
    resolving: [false, false],
    randomizing: [false, false],
    result: null,
    message: initialMessage,
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
  let controller,
    baseline = 0;
  const warn = (text) => {
    state.warning = text;
    emit();
  };
  function clearResult() {
    state.result = null;
    state.warning = "";
    state.progress = { visited: 0, observations: 0 };
    if (!busy()) {
      state.phase = "idle";
      state.message = initialMessage;
    }
  }
  function cancelEndpoint(index) {
    versions[index]++;
    resolving[index]?.abort();
    promises[index] = null;
    state.resolving[index] = false;
    state.randomizing[index] = false;
  }
  function setInput(index, value) {
    if (busy()) return;
    cancelEndpoint(index);
    state.inputs[index] = value;
    state.endpoints[index] = null;
    state.errors[index] = "";
    clearResult();
    emit();
  }
  function selectedIds() {
    const ids = state.endpoints.filter(Boolean).map((user) => user.id);
    for (const input of state.inputs) {
      try {
        ids.push(normalizeInput(input));
      } catch {
        // An unfinished input is not a confirmed identity.
      }
    }
    return new Set(ids);
  }
  function loadEndpoint(index, task, random = false) {
    cancelEndpoint(index);
    const version = versions[index];
    const abort = new AbortController();
    resolving[index] = abort;
    state.resolving[index] = true;
    state.randomizing[index] = random;
    state.errors[index] = "";
    emit();
    const promise = (async () => {
      try {
        let user;
        do {
          user = await task(abort.signal);
          if (versions[index] !== version || abort.signal.aborted) return;
          // Another endpoint may have published the same candidate meanwhile.
        } while (random && selectedIds().has(user.id));
        state.inputs[index] = user.id;
        state.endpoints[index] = { ...user, fetchedAt: now() };
        clearResult();
      } catch (error) {
        if (versions[index] === version && !abort.signal.aborted) {
          state.errors[index] = error.message;
          if (!random) state.endpoints[index] = null;
        }
      } finally {
        if (versions[index] === version) {
          state.resolving[index] = false;
          state.randomizing[index] = false;
          promises[index] = null;
          emit();
        }
      }
    })();
    promises[index] = promise;
    return promise;
  }
  function resolve(index) {
    if (promises[index]) return promises[index];
    const input = state.inputs[index];
    if (!input.trim() || state.endpoints[index]?.id === input)
      return Promise.resolve();
    return loadEndpoint(index, (signal) => site.resolve(input, { signal }));
  }
  async function execute(conditions, abort) {
    baseline = state.requests;
    state.phase = "running";
    clearResult();
    state.message = "沿着好友关系，寻找最短的相遇路线…";
    emit();
    const source = createDataSource({
      store,
      site,
      initialUsers: state.endpoints.filter(Boolean),
      onWarning: (text) => {
        if (controller === abort && !abort.signal.aborted) warn(text);
      },
    });
    try {
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
        const users = await source.users(result.path, { signal: abort.signal });
        abort.signal.throwIfAborted();
        state.result = {
          status: "found",
          conditions,
          path: result.path.map(
            (id) => users.get(id) ?? { id, name: id, avatar: "" },
          ),
        };
        state.message = `已确认最短路径 · ${result.path.length - 1} 跳`;
      } else {
        state.result = { ...result, conditions };
        state.message = {
          unreachable: "此关系模式下没有可达路径。",
          incomplete: "关系数据不完整，本次未能确定路径。",
          invalid: "端点属于已识别的原站无效节点，请换一位班友。",
        }[result.status];
      }
      state.phase = "complete";
    } catch (error) {
      if (controller !== abort) return;
      const stopped = abort.signal.aborted;
      if (!stopped) abort.abort(error);
      state.phase = stopped ? "stopped" : "error";
      state.message = stopped
        ? "已停止。已获取的有效关系缓存保留。"
        : `本次未能确定路径：${error.message}`;
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
    open() {
      state.visible = true;
      emit();
    },
    close() {
      state.visible = false;
      emit();
    },
    setMode(mode) {
      if (!busy() && modes.includes(mode)) {
        state.mode = mode;
        clearResult();
        emit();
      }
    },
    swap() {
      if (busy()) return;
      for (let index = 0; index < 2; index++) cancelEndpoint(index);
      state.inputs.reverse();
      state.endpoints.reverse();
      state.errors.reverse();
      clearResult();
      emit();
    },
    async fill(index, id) {
      if (!id || busy()) return;
      setInput(index, id);
      await resolve(index);
    },
    async random(index) {
      if (busy()) return;
      await loadEndpoint(
        index,
        (signal) =>
          randomUsers.pick({
            signal,
            exclude: selectedIds,
          }),
        true,
      );
    },
    async run() {
      if (busy() || state.randomizing.some(Boolean)) return;
      if (state.inputs.some((value) => !value.trim())) {
        state.errors = state.inputs.map((value) =>
          value.trim() ? "" : "请先填入用户",
        );
        emit();
        return;
      }
      clearResult();
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
        {
          start: state.endpoints[0].id,
          end: state.endpoints[1].id,
          mode: state.mode,
        },
        abort,
      );
    },
    stop() {
      if (!busy() && !state.resolving.some(Boolean)) return;
      controller?.abort(new DOMException("用户停止探索", "AbortError"));
      randomUsers?.cancel();
      for (let index = 0; index < 2; index++) cancelEndpoint(index);
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
