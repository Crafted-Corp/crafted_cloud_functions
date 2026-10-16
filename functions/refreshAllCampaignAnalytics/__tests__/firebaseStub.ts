export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export interface ChildSnapshot {
  key: string;
  val(): Json;
}

export interface Snapshot {
  val(): Json;
  forEach(callback: (child: ChildSnapshot) => void): void;
}

export interface Query {
  once(event: "value"): Promise<Snapshot>;
}

export interface Reference extends Query {
  orderByChild(key: string): { limitToLast(count: number): Query };
  push(): { set(value: Json): Promise<void> };
  set(value: Json): Promise<void>;
  update(value: Json): Promise<void>;
}

export interface Write {
  path: string;
  value: Json;
}

const store = new Map<string, Json>();
export const writes: Write[] = [];

export function reset(seed: Record<string, Json>): void {
  store.clear();
  writes.length = 0;
  for (const [path, value] of Object.entries(seed)) {
    store.set(path, value);
  }
}

function snapshotOf(path: string): Snapshot {
  const value = store.has(path) ? structuredClone(store.get(path) ?? null) : null;
  return {
    val: () => value,
    forEach: (callback) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return;
      for (const [key, child] of Object.entries(value)) {
        callback({ key, val: () => child });
      }
    },
  };
}

function ref(path: string): Reference {
  const record = async (value: Json): Promise<void> => {
    writes.push({ path, value });
  };
  const query: Query = { once: async () => snapshotOf(path) };
  return {
    ...query,
    orderByChild: () => ({ limitToLast: () => query }),
    push: () => ({ set: record }),
    set: record,
    update: record,
  };
}

export function database(): { ref(path: string): Reference } {
  return { ref };
}
