import { NextResponse } from "next/server";
import { formatError } from "@/lib/format-error";
import { buildChainState } from "@/server/chain-state";
import { readVaultTreeState } from "@/server/soroban-vault";

function poolPayload(state: Awaited<ReturnType<typeof buildChainState>>, poolId: number) {
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
    const state = await buildChainState(reader);
    if (reader) {
      state.treeState = await readVaultTreeState(reader, poolId).catch(() => null);
    }
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
      localPoolCommitments?: string[][];
      localCommitments?: string[];
      notes?: Array<{ leafIndex: number; commitment: string; poolId?: number }>;
    };
    const poolId = body.poolId ?? 0;
    const localPool =
      body.localPoolCommitments ??
      (body.localCommitments ? [body.localCommitments] : []);
    const state = await buildChainState(body.reader, localPool, body.notes ?? []);
    if (body.reader) {
      state.treeState = await readVaultTreeState(body.reader, poolId).catch(
        () => null
      );
    }
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
