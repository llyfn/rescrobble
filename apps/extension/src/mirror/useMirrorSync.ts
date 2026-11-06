import { useEffect, useRef, useState } from "react";
import { LastFmReader } from "@rescrobble/core";
import { loadApiKey } from "../backend.ts";
import { MirrorDb, type Scrobble } from "./db.ts";
import { MirrorStore } from "./store.ts";
import { MirrorSync } from "./sync.ts";

/** Opens the Mirror for `username` and syncs it once on open. */
export function useMirrorSync(username: string) {
  const [store] = useState(() => new MirrorStore());
  const [sync, setSync] = useState<MirrorSync | null>(null);
  const dbRef = useRef<MirrorDb | null>(null);

  useEffect(() => {
    let live = true;
    let opened: { db: MirrorDb; sync: MirrorSync } | null = null;
    (async () => {
      const [db, apiKey] = await Promise.all([MirrorDb.open(), loadApiKey()]);
      if (!live) return db.close();
      const engine = new MirrorSync(db, store, new LastFmReader(apiKey), username);
      opened = { db, sync: engine };
      dbRef.current = db;
      setSync(engine);
      await engine.start();
    })().catch(() => live && store.update({ phase: "failed" }));
    return () => {
      live = false;
      opened?.sync.stop();
      opened?.db.close();
    };
  }, [store, username]);

  return {
    store,
    syncNow: () => void sync?.start().catch(() => undefined),
    rebuild: () => void sync?.rebuild().catch(() => undefined),
    /** Swaps a Scrobble for its edited version; its id changes when the artist or track does. */
    replace: async (oldId: string, updated: Scrobble) => {
      store.update({ remove: [oldId], add: [updated] });
      await dbRef.current?.remove([oldId]);
      await dbRef.current?.put([updated]);
    },
    /** Drops Scrobbles that no longer exist on Last.fm from the Mirror. */
    remove: async (ids: string[]) => {
      store.update({ remove: ids });
      await dbRef.current?.remove(ids);
    },
  };
}
