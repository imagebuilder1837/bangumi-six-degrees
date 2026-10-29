import { normalizeInput } from "./site.mjs";

const storageKey = "bangumi-six-degrees:excluded-intermediates";

export function createExclusions({
  site,
  store,
  storage,
  now,
  onUpdate,
  onChange,
}) {
  const state = {
    input: "",
    users: [],
    activity: "idle",
    message: "",
    storageWarning: "",
    cacheWarning: "",
  };
  try {
    const raw = storage?.()?.getItem(storageKey);
    if (raw !== null && raw !== undefined) {
      const saved = JSON.parse(raw);
      if (
        saved.version !== 1 ||
        !Array.isArray(saved.ids) ||
        saved.ids.some(
          (id) => typeof id !== "string" || normalizeInput(id) !== id,
        )
      )
        throw new Error("名单格式无效");
      state.users = [...new Set(saved.ids)].map((id) => ({
        id,
        name: id,
        avatar: "",
      }));
    }
  } catch {
    state.storageWarning = "无法读取排除名单，已按空名单继续；可重新添加班友。";
  }
  function save() {
    try {
      storage().setItem(
        storageKey,
        JSON.stringify({ version: 1, ids: state.users.map(({ id }) => id) }),
      );
      state.storageWarning = "";
    } catch {
      state.storageWarning =
        "排除名单未能保存，当前页面仍生效，刷新后可能丢失。";
    }
    onChange();
  }
  async function loadProfiles() {
    if (!state.users.length) return;
    try {
      const cached = await store.read({
        users: state.users.map(({ id }) => id),
      });
      state.users = state.users.map((user) => {
        const profile = cached.users[user.id];
        return profile &&
          (user.fetchedAt === undefined || profile.fetchedAt > user.fetchedAt)
          ? { ...user, ...profile }
          : user;
      });
      onUpdate();
    } catch {
      state.cacheWarning = "无法读取用户资料缓存，排除名单仍生效。";
      onUpdate();
    }
  }
  // Notify only after the owning session has finished initialization.
  void Promise.resolve().then(loadProfiles);
  let operation;
  function cancelOperation() {
    if (!operation) return false;
    operation.abort();
    operation = undefined;
    state.activity = "idle";
    state.message = "已取消添加。";
    return true;
  }
  return {
    state,
    cancel() {
      if (cancelOperation()) onUpdate();
    },
    setInput(value) {
      cancelOperation();
      state.input = value;
      state.message = "";
      onUpdate();
    },
    async add() {
      if (operation) return;
      if (!state.input.trim()) {
        state.message = "请先填入用户标识。";
        onUpdate();
        return;
      }
      const abort = new AbortController();
      operation = abort;
      state.activity = "resolving";
      state.message = "正在确认用户…";
      onUpdate();
      let user;
      try {
        user = {
          ...(await site.resolve(state.input, { signal: abort.signal })),
          fetchedAt: now(),
        };
        if (operation !== abort) return;
      } catch (error) {
        if (operation !== abort) return;
        operation = undefined;
        state.activity = "idle";
        state.message = `无法添加班友：${error.message}`;
        onUpdate();
        return;
      }
      operation = undefined;
      state.activity = "idle";
      if (state.users.some(({ id }) => id === user.id)) {
        state.message = "这位班友已在名单中。";
        onUpdate();
        return;
      }
      state.users.push(user);
      state.input = "";
      state.message = "已添加排除中转的班友。";
      save();
      try {
        const { name, avatar, fetchedAt } = user;
        await store.commit({
          users: { [user.id]: { name, avatar, fetchedAt } },
        });
      } catch {
        state.cacheWarning = "用户资料缓存保存失败，排除名单仍生效。";
        onUpdate();
      }
    },
    remove(id) {
      if (!state.users.some((user) => user.id === id)) return;
      state.users = state.users.filter((user) => user.id !== id);
      save();
    },
  };
}
