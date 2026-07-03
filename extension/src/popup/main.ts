import * as wallet from "../shared/wallet-ops.js";
import { walletStatus } from "../shared/session-store.js";

type Status = {
  hasWallet: boolean;
  unlocked: boolean;
  publicKey: string | null;
  shieldedAddress: string | null;
};

const els = {
  status: document.getElementById("status")!,
  setup: document.getElementById("view-setup")!,
  unlock: document.getElementById("view-unlock")!,
  wallet: document.getElementById("view-wallet")!,
  error: document.getElementById("error")!,
  setupPassword: document.getElementById("setup-password") as HTMLInputElement,
  importWrap: document.getElementById("import-wrap")!,
  importMnemonic: document.getElementById("import-mnemonic") as HTMLTextAreaElement,
  btnCreate: document.getElementById("btn-create")!,
  btnImportToggle: document.getElementById("btn-import-toggle")!,
  btnImport: document.getElementById("btn-import")!,
  newMnemonic: document.getElementById("new-mnemonic")!,
  unlockPassword: document.getElementById("unlock-password") as HTMLInputElement,
  btnUnlock: document.getElementById("btn-unlock")!,
  stellarPk: document.getElementById("stellar-pk")!,
  shieldedAddr: document.getElementById("shielded-addr")!,
  btnLock: document.getElementById("btn-lock")!,
  btnReset: document.getElementById("btn-reset")!,
};

let importMode = false;

function showError(message: string | null): void {
  if (!message) {
    els.error.classList.add("hidden");
    els.error.textContent = "";
    return;
  }
  els.error.textContent = message;
  els.error.classList.remove("hidden");
}

function hideAllPanels(): void {
  els.setup.classList.add("hidden");
  els.unlock.classList.add("hidden");
  els.wallet.classList.add("hidden");
}

function render(status: Status): void {
  hideAllPanels();
  showError(null);

  if (!status.hasWallet) {
    els.status.textContent = "Create or import a unified wallet (Stellar G + shielded).";
    els.setup.classList.remove("hidden");
    return;
  }

  if (!status.unlocked) {
    els.status.textContent = "Wallet locked — unlock to connect dapps.";
    els.unlock.classList.remove("hidden");
    return;
  }

  els.status.textContent = "Unlocked — connect from the zk-utxo web app.";
  els.wallet.classList.remove("hidden");
  els.stellarPk.textContent = status.publicKey ?? "—";
  els.shieldedAddr.textContent = status.shieldedAddress ?? "—";
}

function setImportMode(on: boolean): void {
  importMode = on;
  els.importWrap.classList.toggle("hidden", !on);
  els.btnImport.classList.toggle("hidden", !on);
  els.btnCreate.classList.toggle("hidden", on);
  els.btnImportToggle.textContent = on ? "Create instead" : "Import instead";
}

async function refresh(): Promise<void> {
  try {
    const status = await walletStatus();
    render(status);
  } catch (err) {
    showError(err instanceof Error ? err.message : "Could not load wallet status");
    els.status.textContent = "Create or import a unified wallet (Stellar G + shielded).";
    els.setup.classList.remove("hidden");
  }
}

els.btnImportToggle.addEventListener("click", () => setImportMode(!importMode));

els.btnCreate.addEventListener("click", () => {
  void (async () => {
    showError(null);
    try {
      const password = els.setupPassword.value;
      const created = await wallet.createWallet(password);
      els.newMnemonic.textContent = created.mnemonic;
      els.newMnemonic.classList.remove("hidden");
      els.setupPassword.value = "";
      await refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Create failed");
    }
  })();
});

els.btnImport.addEventListener("click", () => {
  void (async () => {
    showError(null);
    try {
      const password = els.setupPassword.value;
      const mnemonic = els.importMnemonic.value;
      await wallet.importWallet(mnemonic, password);
      els.setupPassword.value = "";
      els.importMnemonic.value = "";
      await refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Import failed");
    }
  })();
});

els.btnUnlock.addEventListener("click", () => {
  void (async () => {
    showError(null);
    try {
      await wallet.unlockWithPassword(els.unlockPassword.value);
      els.unlockPassword.value = "";
      await refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Unlock failed");
    }
  })();
});

els.btnLock.addEventListener("click", () => {
  void (async () => {
    await wallet.lockWallet();
    await refresh();
  })();
});

els.btnReset.addEventListener("click", () => {
  if (!confirm("Delete wallet from this extension? Back up your recovery phrase first.")) {
    return;
  }
  void (async () => {
    await wallet.resetWallet();
    els.newMnemonic.classList.add("hidden");
    setImportMode(false);
    await refresh();
  })();
});

void refresh();
