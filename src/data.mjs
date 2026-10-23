import { createRelationshipStore } from "../vendor/bangumi-relationship-store/src/index.mjs";

export function browserStore(window) {
  const store = () => createRelationshipStore({ indexedDB: window.indexedDB });
  return {
    read: (query, options) => store().read(query, options),
    commit: (batch, options) => store().commit(batch, options),
  };
}
export function createDataSource({
  kind,
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
    if (!warned) onWarning(`缓存不可用：${error.message}；网络结果不受影响`);
    warned = true;
  };
  return {
    kind,
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
    async load(keys, { signal } = {}) {
      if (kind === "cache") {
        const data = await store.read(
          { relationships: keys, users: [...new Set(keys.map(([id]) => id))] },
          { signal },
        );
        for (const [id, user] of Object.entries(data.users))
          profiles.set(id, { id, ...user });
        return keys.flatMap(([id, direction]) => {
          const snapshot = data.relationships[id]?.[direction];
          return snapshot ? [{ id, direction, snapshot }] : [];
        });
      }
      return Promise.all(
        keys.map(([id, direction]) => {
          const key = JSON.stringify([id, direction]);
          if (!loaded.has(key))
            loaded.set(
              key,
              (async () => {
                const observation = await site.relationships(id, direction, {
                  signal,
                  name: profiles.get(id)?.name,
                });
                const order = ++sequence;
                for (const user of observation.users) {
                  if (
                    !profiles.has(user.id) ||
                    (profiles.get(user.id).fetchedAt ?? 0) <= user.fetchedAt
                  )
                    profiles.set(user.id, user);
                }
                const users = Object.fromEntries(
                  observation.users.map(
                    ({ id: userId, name, avatar, fetchedAt }) => [
                      userId,
                      { name, avatar, fetchedAt },
                    ],
                  ),
                );
                try {
                  await store.commit(
                    {
                      relationships: {
                        [id]: { [direction]: observation.snapshot },
                      },
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
        }),
      );
    },
    async users(ids, { signal } = {}) {
      if (kind === "cache") {
        const data = await store.read({ users: ids }, { signal });
        for (const [id, user] of Object.entries(data.users))
          profiles.set(id, { id, ...user });
      }
      return new Map(
        ids.map((id) => [id, profiles.get(id) ?? { id, name: id, avatar: "" }]),
      );
    },
  };
}
