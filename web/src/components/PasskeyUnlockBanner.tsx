"use client";

import { useEffect, useState } from "react";
import { isPlatformAuthenticatorAvailable, passkeyOriginHint } from "@/lib/passkey";
import { usePasskeyStore } from "@/store/usePasskeyStore";

export function PasskeyUnlockBanner() {
  const { unlocked, unlocking, unlock, error } = usePasskeyStore();
  const [platformOk, setPlatformOk] = useState<boolean | null>(null);
  const originHint = passkeyOriginHint();

  useEffect(() => {
    void isPlatformAuthenticatorAvailable().then(setPlatformOk);
  }, []);

  if (unlocked) return null;

  return (
    <div className="mb-6 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-sky-200">Passkey locked</p>
          <p className="text-xs text-zinc-400">
            Unlock to deposit or exit. First unlock registers a device key
            (Touch ID / Face ID) — note secrets are never stored on-chain.
            {platformOk === false
              ? " No platform authenticator detected — use Safari 17+ or Chrome 118+."
              : null}
          </p>
          {originHint ? (
            <p className="mt-1 text-xs text-amber-300">{originHint}</p>
          ) : null}
          {error ? <p className="mt-1 text-xs text-red-300">{error}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => void unlock()}
          disabled={unlocking}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {unlocking ? "Waiting…" : "Unlock passkey"}
        </button>
      </div>
    </div>
  );
}
