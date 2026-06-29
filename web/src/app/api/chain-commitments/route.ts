import { NextResponse } from "next/server";
import { formatError } from "@/lib/format-error";
import { buildChainState } from "@/server/chain-state";
import { readVaultTreeState } from "@/server/soroban-vault";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const reader = url.searchParams.get("reader") ?? undefined;
    const state = await buildChainState(reader);
    if (reader) {
      state.treeState = await readVaultTreeState(reader, 0).catch(() => null);
    }
    if (state.missing !== null) {
      return NextResponse.json(
        {
          error: `Missing commitment at leaf ${state.missing} — upgrade vault or Notes → Rescan`,
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      reader?: string;
      localChainCommitments?: string[];
      localCommitments?: string[];
      notes?: Array<{ leafIndex: number; commitment: string }>;
    };
    const local = body.localChainCommitments ?? body.localCommitments ?? [];
    const state = await buildChainState(body.reader, local, body.notes ?? []);
    if (body.reader) {
      state.treeState = await readVaultTreeState(body.reader, 0).catch(() => null);
    }
    if (state.missing !== null) {
      return NextResponse.json(
        {
          error: `Missing commitment at leaf ${state.missing} — upgrade vault or Notes → Rescan`,
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
