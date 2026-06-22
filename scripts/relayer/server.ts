#!/usr/bin/env npx tsx
import { startSubmitServer } from "./submit.ts";

/**
 * Open relayer: POST /submit { "xdr": "<signed>" } to broadcast Soroban txs.
 * Exit payouts are atomic in the vault contract (Tornado-style); no off-chain payout.
 */
startSubmitServer();
