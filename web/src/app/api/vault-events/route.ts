import { NextResponse } from "next/server";
import { formatError } from "@/lib/format-error";
import { serializeVaultEvents } from "@/lib/vault-events-serde";
import { buildChainState } from "@/server/chain-state";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      reader?: string;
      localCommitments?: string[];
      requireComplete?: boolean;
    };

    const state = await buildChainState(body.reader, body.localCommitments ?? []);
    const payload = {
      events: serializeVaultEvents(state.events),
      commitments: state.commitments,
      eventCount: state.eventCount,
      leafCount: state.leafCount,
      merkleRoot: state.merkleRoot,
      missing: state.missing,
    };

    if (body.requireComplete && state.missing !== null) {
      return NextResponse.json(
        {
          error: `Missing commitment at leaf ${state.missing} — redeploy vault (get_filled_at_level) or Rescan`,
          ...payload,
        },
        { status: 409 }
      );
    }

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: formatError(error) || "vault events fetch failed" },
      { status: 500 }
    );
  }
}
