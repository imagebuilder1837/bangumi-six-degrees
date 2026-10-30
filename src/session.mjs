import { search } from "./search.mjs";
import { createDataSource } from "./data.mjs";
import { normalizeInput } from "./site.mjs";
import { createExclusions } from "./exclusions.mjs";
import { createHistory } from "./history.mjs";

const modes = ["mutual", "directed", "undirected"];
const initialMessage = "选两位班友，看看相隔几跳。";

function immutable(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  return Object.freeze(
    Array.isArray(value)
      ? value.map(immutable)
      : Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, immutable(item)]),
        ),
  );
}
function endpoint(user, now) {
  return {
    input: user?.id ?? "",
    user: user ? immutable({ ...user, fetchedAt: now() }) : null,
    activity: "idle",
    error: null,
  };
}

/**
 * state and subscription values are immutable snapshots, stable until the next
 * notification. Endpoint activity is idle/resolving/randomizing; operation
 * permissions are derived here, not by callers. Subscriptions publish immediately.
 */
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
  const exclusions = createExclusions({
    site,
    store,
    storage,
    now,
    onUpdate: () => emit(),
    onChange: () => {
      clearResult();
      emit();
    },
  });
  const history = createHistory({
    store,
    storage,
    now,
    onUpdate: () => emit(),
  });
  const state = {
    exclusions: exclusions.state,
    history: history.state,
    visible: false,
    phase: "idle",
    mode: "mutual",
    endpoints: [endpoint(current, now), endpoint(null, now)],
    result: null,
    message: initialMessage,
    progress: { visited: 0, observations: 0 },
    warning: "",
  };
  const busy = () => ["resolving", "running"].includes(state.phase);
  const permissions = () => ({
    canEdit: !busy(),
    canRun:
      !busy() &&
      state.exclusions.activity !== "resolving" &&
      !state.endpoints.some((item) => item.activity === "randomizing"),
    canStop:
      busy() ||
      state.exclusions.activity === "resolving" ||
      state.endpoints.some((item) => item.activity !== "idle"),
  });
  let snapshot = immutable({ ...state, ...permissions() });
  const listeners = new Set();
  const emit = () => {
    snapshot = immutable({ ...state, ...permissions() });
    for (const listener of listeners) listener(snapshot);
  };
  const versions = [0, 0],
    resolving = [null, null],
    promises = [null, null];
  let controller;
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
    resolving[index] = null;
    promises[index] = null;
    state.endpoints[index].activity = "idle";
  }
  function setInput(index, value) {
    if (!permissions().canEdit) return;
    cancelEndpoint(index);
    Object.assign(state.endpoints[index], {
      input: value,
      user: null,
      error: null,
    });
    clearResult();
    emit();
  }
  function selectedIds() {
    const ids = [];
    for (const { input, user } of state.endpoints) {
      if (user) ids.push(user.id);
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
    const item = state.endpoints[index];
    item.activity = random ? "randomizing" : "resolving";
    item.error = null;
    emit();
    const promise = (async () => {
      try {
        let user;
        do {
          user = await task(abort.signal);
          if (versions[index] !== version || abort.signal.aborted) return;
          // Another endpoint may have published the same candidate meanwhile.
        } while (random && selectedIds().has(user.id));
        item.input = user.id;
        item.user = immutable({ ...user, fetchedAt: now() });
        clearResult();
      } catch (error) {
        if (versions[index] === version && !abort.signal.aborted) {
          item.error = {
            code: error?.code ?? "unknown",
            message: error?.message ?? String(error),
          };
          if (!random) item.user = null;
        }
      } finally {
        if (versions[index] === version) {
          item.activity = "idle";
          resolving[index] = null;
          promises[index] = null;
          emit();
        }
      }
    })();
    promises[index] = promise;
    return promise;
  }
  function resolveEndpoint(index) {
    if (promises[index]) return promises[index];
    const { input, user } = state.endpoints[index];
    if (!input.trim() || user?.id === input) return Promise.resolve();
    return loadEndpoint(index, (signal) => site.resolve(input, { signal }));
  }
  async function execute(conditions, abort) {
    state.phase = "running";
    clearResult();
    state.message = "正在沿好友关系寻找最短路径…";
    emit();
    const source = createDataSource({
      store,
      site,
      initialUsers: state.endpoints.flatMap(({ user }) => (user ? [user] : [])),
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
            state.message =
              progress.stage === "relations"
                ? "正在核实路径上的好友方向…"
                : "正在沿好友关系寻找最短路径…";
            emit();
          }
        },
      });
      abort.signal.throwIfAborted();
      const users = await source.users(
        result.status === "found"
          ? result.path
          : [conditions.start, conditions.end],
        { signal: abort.signal },
      );
      abort.signal.throwIfAborted();
      if (result.status === "found") {
        state.result = immutable({
          status: "found",
          conditions,
          relations: result.relations,
          path: result.path.map(
            (id) => users.get(id) ?? { id, name: id, avatar: "" },
          ),
        });
        state.message =
          result.path.length === 1
            ? "同一位班友，0 跳。"
            : `相隔 ${result.path.length - 1} 跳`;
      } else {
        state.result = immutable({ ...result, conditions });
        state.message = {
          unreachable: "已确认不可达",
          incomplete: "关系数据不足，路径待确认。",
          invalid: "端点属于已识别的原站无效节点。",
        }[result.status];
      }
      state.phase = "complete";
      history.record(state.result, [
        users.get(conditions.start),
        users.get(conditions.end),
      ]);
    } catch (error) {
      if (controller !== abort) return;
      const stopped = abort.signal.aborted;
      if (!stopped) abort.abort(error);
      state.phase = stopped ? "stopped" : "error";
      state.message = stopped
        ? "探索已停止。"
        : `${state.progress.stage === "relations" ? "好友方向核实中断" : "本次探索中断"}：${error.message}`;
    } finally {
      if (controller === abort) {
        controller = undefined;
        emit();
      }
    }
  }
  return {
    get state() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    setInput,
    clearHistory() {
      history.clear();
      emit();
    },
    setExcludedInput(value) {
      if (permissions().canEdit) exclusions.setInput(value);
    },
    addExcluded() {
      return permissions().canEdit ? exclusions.add() : Promise.resolve();
    },
    removeExcluded(id) {
      if (permissions().canEdit) exclusions.remove(id);
    },
    cancelExcluded() {
      exclusions.cancel();
    },
    resolve(index) {
      return permissions().canEdit ? resolveEndpoint(index) : Promise.resolve();
    },
    open() {
      state.visible = true;
      emit();
    },
    close() {
      state.visible = false;
      emit();
    },
    setMode(mode) {
      if (permissions().canEdit && modes.includes(mode)) {
        state.mode = mode;
        clearResult();
        emit();
      }
    },
    swap() {
      if (!permissions().canEdit) return;
      for (let index = 0; index < 2; index++) cancelEndpoint(index);
      state.endpoints.reverse();
      clearResult();
      emit();
    },
    async fill(index, id) {
      if (!id || !permissions().canEdit) return;
      setInput(index, id);
      await resolveEndpoint(index);
    },
    async random(index) {
      if (!permissions().canEdit) return;
      await loadEndpoint(
        index,
        (signal) => randomUsers.pick({ signal, exclude: selectedIds }),
        true,
      );
    },
    async run() {
      if (!permissions().canRun) return;
      if (state.endpoints.some(({ input }) => !input.trim())) {
        for (const item of state.endpoints)
          item.error = item.input.trim()
            ? null
            : { code: "input-required", message: "请先填入用户" };
        emit();
        return;
      }
      clearResult();
      const abort = new AbortController();
      controller = abort;
      state.phase = "resolving";
      state.message = "正在确认两位用户…";
      emit();
      await Promise.all(
        [0, 1].map((index) =>
          state.endpoints[index].user ? undefined : resolveEndpoint(index),
        ),
      );
      if (abort.signal.aborted) return;
      if (state.endpoints.some(({ user }) => !user)) {
        state.phase = "error";
        state.message = "请先修正用户输入。";
        controller = undefined;
        emit();
        return;
      }
      await execute(
        {
          start: state.endpoints[0].user.id,
          end: state.endpoints[1].user.id,
          mode: state.mode,
          excluded: state.exclusions.users.map(({ id }) => id),
        },
        abort,
      );
    },
    stop() {
      exclusions.cancel();
      if (!permissions().canStop) return;
      controller?.abort(new DOMException("用户停止探索", "AbortError"));
      randomUsers?.cancel();
      for (let index = 0; index < 2; index++) cancelEndpoint(index);
      state.phase = "stopped";
      state.message = "探索已停止。";
      emit();
    },
  };
}
