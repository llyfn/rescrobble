import { useEffect, useState } from "react";
import { LastFmReader } from "@rescrobble/core";
import { loadApiKey } from "../backend.ts";
import { MirrorDb } from "./db.ts";
import { MirrorStore } from "./store.ts";
import { MirrorSync } from "./sync.ts";

/** Opens the Mirror for `username` and syncs it once on open. */
export function useMirrorSync(username: string) {
  const [store] = useState(() => new MirrorStore());
  const [sync, setSync] = useState<MirrorSync | null>(null);

  useEffect(() => {
    let live = true;
    let opened: { db: MirrorDb; sync: MirrorSync } | null = null;
    (async () => {
      const [db, apiKey] = await Promise.all([MirrorDb.open(), loadApiKey()]);
      if (!live) return db.close();
      const engine = new MirrorSync(db, store, new LastFmReader(apiKey), username);
      opened = { db, sync: engine };
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
  };
}
