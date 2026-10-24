const key = (id, direction) => JSON.stringify([id, direction]);
function setAt(map, id) {
  if (!map.has(id)) map.set(id, new Set());
  return map.get(id);
}

// An observation is a complete directional list, not just positive edges.
export class ObservationGraph {
  constructor() {
    this.records = new Map();
    this.outgoing = new Map();
    this.incoming = new Map();
    this.sequence = 0;
  }
  get(id, direction) {
    return this.records.get(key(id, direction));
  }
  invalid(id) {
    return ["friends", "rev_friends"].some(
      (direction) => this.get(id, direction)?.status === "unavailable",
    );
  }
  candidates(id) {
    return new Set([
      ...(this.outgoing.get(id) ?? []),
      ...(this.incoming.get(id) ?? []),
    ]);
  }
  observe({ id, direction, snapshot, order }) {
    const affected = this.candidates(id);
    affected.add(id);
    const previous = this.get(id, direction);
    const record = {
      ...snapshot,
      members: new Set(snapshot.members ?? []),
      order: order ?? ++this.sequence,
    };
    if (previous && previous.order > record.order) return new Set();
    this.records.set(key(id, direction), record);
    for (const other of new Set([
      ...(previous?.members ?? []),
      ...record.members,
    ])) {
      const from = direction === "friends" ? id : other;
      const to = direction === "friends" ? other : id;
      const exists =
        this.get(from, "friends")?.members.has(to) ||
        this.get(to, "rev_friends")?.members.has(from);
      for (const [map, owner, member] of [
        [this.outgoing, from, to],
        [this.incoming, to, from],
      ]) {
        if (exists) setAt(map, owner).add(member);
        else map.get(owner)?.delete(member);
      }
      affected.add(other);
    }
    for (const other of this.candidates(id)) affected.add(other);
    return affected;
  }
  edge(from, to) {
    if (this.invalid(from) || this.invalid(to)) return false;
    const forward = this.get(from, "friends");
    const reverse = this.get(to, "rev_friends");
    if (!forward && !reverse) return false;
    const chosen = !forward
      ? reverse
      : !reverse || forward.order >= reverse.order
        ? forward
        : reverse;
    return chosen.members.has(chosen === forward ? to : from);
  }
  directions(mode, backward) {
    return mode === "directed"
      ? [backward ? "rev_friends" : "friends"]
      : ["friends", "rev_friends"];
  }
  complete(id, mode, backward) {
    return (
      this.invalid(id) ||
      this.directions(mode, backward).every((direction) =>
        this.get(id, direction),
      )
    );
  }
  neighbors(id, mode, backward) {
    if (this.invalid(id)) return new Set();
    return new Set(
      [...this.candidates(id)].filter((other) => {
        const forward = this.edge(id, other);
        const reverse = this.edge(other, id);
        if (mode === "undirected") return forward || reverse;
        if (mode === "mutual") return forward && reverse;
        return backward ? reverse : forward;
      }),
    );
  }
}
