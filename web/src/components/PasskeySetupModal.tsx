"use client";

interface PasskeySetupModalProps {
  onComplete: () => void;
  onCancel?: () => void;
}

export function PasskeySetupModal({
  onComplete,
  onCancel,
}: PasskeySetupModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="max-w-lg rounded-2xl border border-sky-500/30 bg-[#12182a] p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-sky-200">Create your passkey</h3>
        <p className="mt-2 text-sm text-zinc-300">
          Your shielded wallet uses a <strong className="font-medium text-zinc-100">passkey</strong>{" "}
          instead of a 12-word phrase. Touch ID, Face ID, or a security key derives note secrets
          via WebAuthn PRF — the root key never leaves the authenticator.
        </p>
        <ul className="mt-3 space-y-1 text-xs text-zinc-400">
          <li>• zk1 receive address is tied to this passkey</li>
          <li>• Add a recovery passkey later in Notes</li>
          <li>• Syncs across devices via iCloud Keychain / Google Password Manager</li>
        </ul>
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onComplete()}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
          >
            Continue with passkey
          </button>
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-white/15 px-4 py-2 text-sm text-zinc-300 hover:bg-white/10"
            >
              Cancel
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
