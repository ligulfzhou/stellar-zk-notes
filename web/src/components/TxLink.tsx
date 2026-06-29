import { stellarExpertTxUrl } from "@/lib/explorer";

export function TxLink({ txHash }: { txHash: string }) {
  return (
    <a
      href={stellarExpertTxUrl(txHash)}
      target="_blank"
      rel="noopener noreferrer"
      className="underline decoration-emerald-400/60 underline-offset-2 hover:text-emerald-200"
    >
      {txHash.slice(0, 12)}…
    </a>
  );
}
