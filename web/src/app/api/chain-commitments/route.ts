import { NextResponse } from "next/server";
import { formatError } from "@/lib/format-error";
import { buildChainState } from "@/server/chain-state";

export async function GET(request: Request) {
  try {
    const reader = new URL(request.url).searchParams.get("reader") ?? undefined;
    const state = await buildChainState(reader);
    if (state.missing !== null) {
      return NextResponse.json(
        {
          error: `Missing commitment at leaf ${state.missing} — upgrade vault (get_filled_at_level) or Notes → Rescan`,
          commitments: state.commitments,
          eventCount: state.eventCount,
          leafCount: state.leafCount,
          merkleRoot: state.merkleRoot,
          treeState: state.treeState,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({
      commitments: state.commitments,
      eventCount: state.eventCount,
      leafCount: state.leafCount,
      merkleRoot: state.merkleRoot,
      treeState: state.treeState,
    });
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
      localCommitments?: string[];
      notes?: Array<{ leafIndex: number; commitment: string }>;
    };
    const state = await buildChainState(
      body.reader,
      body.localCommitments ?? [],
      body.notes ?? []
    );
    if (state.missing !== null) {
      return NextResponse.json(
        {
          error: `Missing commitment at leaf ${state.missing} — upgrade vault (get_filled_at_level) or Notes → Rescan`,
          commitments: state.commitments,
          eventCount: state.eventCount,
          leafCount: state.leafCount,
          merkleRoot: state.merkleRoot,
          treeState: state.treeState,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({
      commitments: state.commitments,
      eventCount: state.eventCount,
      leafCount: state.leafCount,
      merkleRoot: state.merkleRoot,
      treeState: state.treeState,
    });
  } catch (error) {
    return NextResponse.json(
      { error: formatError(error) || "chain fetch failed" },
      { status: 500 }
    );
  }
}
