import { NextResponse } from "next/server";
import { formatError } from "@/lib/format-error";
import {
  buildChainState,
  buildChainStateForProve,
  type ChainState,
} from "@/server/chain-state";

function poolPayload(state: ChainState, poolId: number) {
  return {
    poolId,
    commitments: state.poolCommitments[poolId] ?? [],
    poolCommitments: state.poolCommitments,
    eventCount: state.eventCount,
    leafCount: state.poolLeafCounts[poolId] ?? state.leafCount,
    merkleRoot: state.poolMerkleRoots[poolId] ?? state.merkleRoot,
    treeState: state.treeState,
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const reader = url.searchParams.get("reader") ?? undefined;
    const poolId = Number(url.searchParams.get("poolId") ?? "0");
    const mode = url.searchParams.get("mode") ?? "prove";
    if (!reader) {
      return NextResponse.json({ error: "reader required" }, { status: 400 });
    }
    const state =
      mode === "full"
        ? await buildChainState(reader, [], [], { poolId })
        : await buildChainStateForProve(reader, poolId);
    if (state.missing !== null) {
      return NextResponse.json(
        {
          error: `Missing commitment at leaf ${state.missing} — upgrade vault or Notes → Rescan`,
          ...poolPayload(state, poolId),
        },
        { status: 409 }
      );
    }
    return NextResponse.json(poolPayload(state, poolId));
  } catch (error) {
    return NextResponse.json(
      { error: formatError(error) || "chain fetch failed" },
      { status: 500 }
    );
  }
}

/** Merge server chain scan with client-local commitments (IndexedDB). */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      reader?: string;
      poolId?: number;
      /** `prove` (default): contract-only, no event scan. `full`: events + local merge. */
      mode?: "prove" | "full";
      localPoolCommitments?: string[][];
      localCommitments?: string[];
      notes?: Array<{ leafIndex: number; commitment: string; poolId?: number }>;
    };
    const poolId = body.poolId ?? 0;
    if (!body.reader) {
      return NextResponse.json({ error: "reader required" }, { status: 400 });
    }
    const mode = body.mode ?? "prove";
    const state =
      mode === "full"
        ? await buildChainState(
            body.reader,
            body.localPoolCommitments ??
              (body.localCommitments ? [body.localCommitments] : []),
            body.notes ?? [],
            { poolId }
          )
        : await buildChainStateForProve(body.reader, poolId);
    if (state.missing !== null) {
      return NextResponse.json(
        {
          error: `Missing commitment at leaf ${state.missing} — upgrade vault or Notes → Rescan`,
          ...poolPayload(state, poolId),
        },
        { status: 409 }
      );
    }
    return NextResponse.json(poolPayload(state, poolId));
  } catch (error) {
    return NextResponse.json(
      { error: formatError(error) || "chain fetch failed" },
      { status: 500 }
    );
  }
}
