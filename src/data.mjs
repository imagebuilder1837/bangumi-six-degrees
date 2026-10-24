import { createRelationshipStore } from "../vendor/bangumi-relationship-store/src/index.mjs";

export function browserStore(window) {
  const store = () => createRelationshipStore({ indexedDB: window.indexedDB });
  return {
    read: (query, options) => store().read(query, options),
    commit: (batch, options) => store().commit(batch, options),
  };
}
export function createDataSource({
  store,
  site,
  initialUsers = [],
  onWarning = () => {},
}) {
  const profiles = new Map(initialUsers.map((user) => [user.id, user]));
  const loaded = new Map();
  let sequence = 0;
  let warned = false;
  const warning = (error) => {
    if (!warned)
      onWarning(
        `关系缓存保存失败：${error.message}；本次探索继续使用网络数据。`,
      );
    warned = true;
  };
  function loadOne(id, direction, signal) {
    const key = JSON.stringify([id, direction]);
    if (!loaded.has(key))
      loaded.set(
        key,
        (async () => {
          const observation = await site.relationships(id, direction, {
            signal,
            name: profiles.get(id)?.name,
          });
          signal?.throwIfAborted();
          // Network completion, not cache commit order, arbitrates observations.
          const order = ++sequence;
          for (const user of observation.users) {
            if (
              !profiles.has(user.id) ||
              (profiles.get(user.id).fetchedAt ?? 0) <= user.fetchedAt
            )
              profiles.set(user.id, user);
          }
          const users = Object.fromEntries(
            observation.users.map(({ id: userId, name, avatar, fetchedAt }) => [
              userId,
              { name, avatar, fetchedAt },
            ]),
          );
          try {
            await store.commit(
              {
                relationships: { [id]: { [direction]: observation.snapshot } },
                users,
              },
              { signal },
            );
          } catch (error) {
            signal?.throwIfAborted();
            warning(error);
          }
          return { id, direction, snapshot: observation.snapshot, order };
        })(),
      );
    return loaded.get(key);
  }
  return {
    async estimate(keys, { signal } = {}) {
      if (!keys.length) return 0;
      try {
        const data = await store.read({ relationships: keys }, { signal });
        return keys.reduce(
          (cost, [id, direction]) =>
            cost +
            1 +
            (data.relationships[id]?.[direction]?.members?.length ?? 100) / 100,
          0,
        );
      } catch (error) {
        signal?.throwIfAborted();
        return keys.length * 2;
      }
    },
    // A source belongs to one exploration. Batches retain input order and share
    // fetched observations, but only produce a bounded number of pending tasks.
    async load(keys, { signal } = {}) {
      signal?.throwIfAborted();
      const results = new Array(keys.length);
      let next = 0;
      let failed = false;
      async function worker() {
        try {
          while (!failed && next < keys.length) {
            signal?.throwIfAborted();
            const index = next++;
            const [id, direction] = keys[index];
            results[index] = await loadOne(id, direction, signal);
          }
        } catch (error) {
          failed = true;
          throw error;
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(4, keys.length) }, () => worker()),
      );
      return results;
    },
    async users(ids) {
      return new Map(
        ids.map((id) => [id, profiles.get(id) ?? { id, name: id, avatar: "" }]),
      );
    },
  };
}
