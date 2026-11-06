import { useSyncExternalStore } from "react";
import type { MirrorSnapshot, MirrorStore } from "./store.ts";

export function useMirror(store: MirrorStore): MirrorSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
