import { ObservationGraph } from "./graph.mjs";

class SearchSide {
  constructor(root) {
    this.root = root;
    this.distances = new Map([[root, 0]]);
    this.parents = new Map();
    this.children = new Map();
    this.expanded = new Map();
    this.incoming = new Map();
    this.blocked = new Set();
  }
  frontier() {
    let depth = Infinity;
    let ids = [];
    for (const [id, distance] of this.distances) {
      if (this.expanded.has(id)) continue;
      if (distance < depth) {
        depth = distance;
        ids = [];
      }
      if (distance === depth) ids.push(id);
    }
    return { depth, ids: ids.filter((id) => !this.blocked.has(id)) };
  }
  // Remove only dependent parent subtrees; unaffected labels and fetched lists survive.
  change(changes) {
    const removedParents = [];
    for (const [id, neighbors] of changes) {
      const old = this.expanded.get(id) ?? new Set();
      for (const other of old)
        if (!neighbors.has(other)) {
          this.incoming.get(other)?.delete(id);
          if (this.parents.get(other) === id) removedParents.push(other);
        }
      for (const other of neighbors) {
        if (!this.incoming.has(other)) this.incoming.set(other, new Set());
        this.incoming.get(other).add(id);
      }
      this.expanded.set(id, neighbors);
    }
    const invalidated = new Set();
    const pending = [...removedParents];
    while (pending.length) {
      const id = pending.pop();
      if (id === this.root || invalidated.has(id)) continue;
      invalidated.add(id);
      pending.push(...(this.children.get(id) ?? []));
      this.children.get(this.parents.get(id))?.delete(id);
      this.children.delete(id);
      this.parents.delete(id);
      this.distances.delete(id);
    }
    const seeds = new Set(changes.keys());
    for (const id of invalidated)
      for (const parent of this.incoming.get(id) ?? []) seeds.add(parent);
    const queue = [...seeds].filter((id) => this.distances.has(id));
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index];
      const distance = this.distances.get(id) + 1;
      for (const other of this.expanded.get(id) ?? []) {
        if (distance >= (this.distances.get(other) ?? Infinity)) continue;
        this.children.get(this.parents.get(other))?.delete(other);
        this.parents.set(other, id);
        if (!this.children.has(id)) this.children.set(id, new Set());
        this.children.get(id).add(other);
        this.distances.set(other, distance);
        queue.push(other);
      }
    }
  }
}

function pathThrough(sides, meeting) {
  const path = [meeting];
  for (let id = meeting; sides[0].parents.has(id);) {
    id = sides[0].parents.get(id);
    path.unshift(id);
  }
  for (let id = meeting; sides[1].parents.has(id);) {
    id = sides[1].parents.get(id);
    path.push(id);
  }
  return path;
}

export async function search({
  start,
  end,
  mode = "directed",
  source,
  signal = new AbortController().signal,
  onProgress = () => {},
}) {
  if (!["directed", "undirected", "mutual"].includes(mode))
    throw new Error("未知关系模式");
  const graph = new ObservationGraph();
  const sides = [new SearchSide(start), new SearchSide(end)];
  const attempted = new Set();
  let observations = 0;
  const keysFor = (ids, backward) =>
    ids.flatMap((id) =>
      graph
        .directions(mode, backward)
        .filter(
          (direction) =>
            !graph.get(id, direction) &&
            !attempted.has(JSON.stringify([id, direction])),
        )
        .map((direction) => [id, direction]),
    );
  // Both expansion and direction completion enter the same observation view.
  async function load(keys, index = -1, ids = []) {
    const records = keys.length ? await source.load(keys, { signal }) : [];
    signal.throwIfAborted();
    for (const key of keys) attempted.add(JSON.stringify(key));
    const affected = new Set();
    for (const record of records) {
      observations++;
      for (const id of graph.observe(record)) affected.add(id);
    }
    for (const id of ids) {
      if (graph.complete(id, mode, index === 1)) affected.add(id);
      else sides[index].blocked.add(id);
    }
    sides.forEach((side, sideIndex) => {
      const changes = new Map();
      for (const id of affected) {
        if (graph.complete(id, mode, sideIndex === 1)) side.blocked.delete(id);
        if (
          side.expanded.has(id) ||
          (sideIndex === index &&
            ids.includes(id) &&
            graph.complete(id, mode, sideIndex === 1))
        ) {
          changes.set(id, graph.neighbors(id, mode, sideIndex === 1));
        }
      }
      side.change(changes);
    });
  }
  while (true) {
    signal.throwIfAborted();
    if (graph.invalid(start) || graph.invalid(end))
      return { status: "invalid" };
    const layers = sides.map((side) => side.frontier());
    let meeting,
      length = Infinity;
    for (const [id, distance] of sides[0].distances) {
      const total = distance + (sides[1].distances.get(id) ?? Infinity);
      if (total < length) {
        length = total;
        meeting = id;
      }
    }
    const progress = {
      visited: new Set(sides.flatMap((side) => [...side.distances.keys()]))
        .size,
      observations,
    };
    if (meeting !== undefined && length <= layers[0].depth + layers[1].depth) {
      const path = pathThrough(sides, meeting);
      const relations = path.slice(1).map((id, index) => ({
        forward: graph.edge(path[index], id),
        reverse: graph.edge(id, path[index]),
      }));
      const unknown = relations.findIndex(
        ({ forward, reverse }) => forward === null || reverse === null,
      );
      onProgress({ ...progress, stage: "relations" });
      if (unknown === -1) return { status: "found", path, relations };
      const [from, to] =
        relations[unknown].forward === null
          ? [path[unknown], path[unknown + 1]]
          : [path[unknown + 1], path[unknown]];
      const key = [
        [from, "friends"],
        [to, "rev_friends"],
      ].find((key) => !attempted.has(JSON.stringify(key)));
      if (!key) return { status: "incomplete" };
      await load([key]);
      continue;
    }
    onProgress({ ...progress, stage: "search" });
    if (layers.some((layer) => layer.depth === Infinity))
      return { status: "unreachable" };
    if (layers.every((layer) => !layer.ids.length))
      return { status: "incomplete" };
    const keys = layers.map((layer, index) => keysFor(layer.ids, index === 1));
    const costs = await Promise.all(
      layers.map(async (layer, index) => {
        if (!layer.ids.length) return Infinity;
        try {
          return (
            (await source.estimate?.(keys[index], { signal })) ??
            layer.ids.length
          );
        } catch {
          signal.throwIfAborted();
          return layer.ids.length;
        }
      }),
    );
    signal.throwIfAborted();
    const index = costs[0] <= costs[1] ? 0 : 1;
    await load(keys[index], index, layers[index].ids);
  }
}
