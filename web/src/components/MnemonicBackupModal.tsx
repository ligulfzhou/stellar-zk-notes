"use client";

interface MnemonicBackupModalProps {
  mnemonic: string;
  onConfirm: () => void;
}

export function MnemonicBackupModal({
  mnemonic,
  onConfirm,
}: MnemonicBackupModalProps) {
  const words = mnemonic.split(" ");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="max-w-lg rounded-2xl border border-amber-500/30 bg-[#12182a] p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-amber-200">Save your recovery phrase</h3>
        <p className="mt-2 text-sm text-zinc-300">
          Write these 12 words down in order. They derive every Note&apos;s secrets — you can
          recover shielded funds on a new device without exporting JSON.
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-black/40 p-4 font-mono text-sm">
          {words.map((word, i) => (
            <span key={word + i} className="text-zinc-200">
              <span className="text-zinc-500">{i + 1}.</span> {word}
            </span>
          ))}
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Never share this phrase. Anyone with it can spend your shielded notes.
        </p>
        <button
          type="button"
          onClick={onConfirm}
          className="mt-5 w-full rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500"
        >
          I&apos;ve saved it
        </button>
      </div>
    </div>
  );
}
