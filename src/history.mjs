import { normalizeInput } from "./site.mjs";

const storageKey = "bangumi-six-degrees:recent-explorations";
const fields = [
  "start",
  "end",
  "status",
  "hops",
  "mode",
  "hasExclusions",
  "completedAt",
];
function validEntry(entry) {
  return (
    entry &&
    typeof entry === "object" &&
    Object.keys(entry).length === fields.length &&
    fields.every((field) => Object.hasOwn(entry, field)) &&
    [entry.start, entry.end].every(
      (id) => typeof id === "string" && normalizeInput(id) === id,
    ) &&
    ["mutual", "directed", "undirected"].includes(entry.mode) &&
    typeof entry.hasExclusions === "boolean" &&
    Number.isSafeInteger(entry.completedAt) &&
    entry.completedAt >= 0 &&
    entry.completedAt <= 8640000000000000 &&
    (entry.status === "unreachable"
      ? entry.hops === null
      : entry.status === "found" &&
        Number.isSafeInteger(entry.hops) &&
        entry.hops >= 0 &&
        (entry.hops === 0) === (entry.start === entry.end))
  );
}

export function createHistory({ store, storage, now, onUpdate }) {
  const state = {
    entries: [],
    users: {},
    storageWarning: "",
    cacheWarning: "",
  };
  try {
    const raw = storage?.()?.getItem(storageKey);
    if (raw !== null && raw !== undefined) {
      const saved = JSON.parse(raw);
      if (
        saved?.version !== 1 ||
        !Array.isArray(saved.entries) ||
        saved.entries.length > 5 ||
        !saved.entries.every(validEntry)
      )
        throw new Error("探索记录格式无效");
      state.entries = saved.entries;
    }
  } catch {
    state.storageWarning = "无法读取探索记录，已按空记录继续。";
  }
  let revision = 0;
  function mergeProfiles(profiles) {
    const ids = new Set(
      state.entries.flatMap(({ start, end }) => [start, end]),
    );
    state.users = Object.fromEntries(
      [...ids].flatMap((id) => {
        const previous = Object.hasOwn(state.users, id)
          ? state.users[id]
          : null;
        const incoming = Object.hasOwn(profiles, id) ? profiles[id] : null;
        const profile =
          incoming && (!previous || incoming.fetchedAt >= previous.fetchedAt)
            ? incoming
            : previous;
        return profile ? [[id, profile]] : [];
      }),
    );
  }
  async function loadProfiles() {
    if (!state.entries.length) return;
    const version = revision;
    try {
      const cached = await store.read({
        users: [
          ...new Set(state.entries.flatMap(({ start, end }) => [start, end])),
        ],
      });
      if (version !== revision) return;
      mergeProfiles(cached.users);
    } catch {
      if (version !== revision) return;
      state.cacheWarning = "无法读取用户资料缓存，探索记录仍保留。";
    }
    onUpdate();
  }
  void Promise.resolve().then(loadProfiles);
  return {
    state,
    clear() {
      revision++;
      state.entries = [];
      state.users = {};
      state.cacheWarning = "";
      try {
        storage().removeItem(storageKey);
        state.storageWarning = "";
      } catch {
        state.storageWarning =
          "探索记录未能清空，当前页面已清空，刷新后可能重新出现。";
      }
    },
    record(result, users) {
      if (!["found", "unreachable"].includes(result.status)) return;
      const remaining = state.entries.filter(
        (entry) =>
          entry.start !== result.conditions.start ||
          entry.end !== result.conditions.end ||
          entry.mode !== result.conditions.mode,
      );
      state.entries = [
        {
          start: result.conditions.start,
          end: result.conditions.end,
          status: result.status,
          hops: result.status === "found" ? result.path.length - 1 : null,
          mode: result.conditions.mode,
          hasExclusions: !!result.conditions.excluded.length,
          completedAt: now(),
        },
        ...remaining,
      ].slice(0, 5);
      try {
        storage().setItem(
          storageKey,
          JSON.stringify({ version: 1, entries: state.entries }),
        );
        state.storageWarning = "";
      } catch {
        state.storageWarning =
          "探索记录未能保存，当前页面仍可查看，刷新后可能丢失。";
      }
      const profiles = Object.fromEntries(
        users.map(({ id, name, avatar, fetchedAt }) => [
          id,
          { name, avatar, fetchedAt },
        ]),
      );
      mergeProfiles(profiles);
      const version = revision;
      void (async () => {
        try {
          // The shared store overwrites directly. Compare these two profiles
          // before writing so a stale page does not roll back known newer data.
          const cached = await store.read({ users: Object.keys(profiles) });
          if (version !== revision) return;
          const updates = Object.fromEntries(
            Object.entries(profiles).filter(
              ([id, profile]) =>
                !Object.hasOwn(cached.users, id) ||
                cached.users[id].fetchedAt <= profile.fetchedAt,
            ),
          );
          mergeProfiles({ ...cached.users, ...updates });
          state.cacheWarning = "";
          onUpdate();
          if (Object.keys(updates).length)
            await store.commit({ users: updates });
        } catch {
          if (version !== revision) return;
          state.cacheWarning = "用户资料缓存保存失败，探索记录仍保留。";
          onUpdate();
        }
      })();
    },
  };
}
