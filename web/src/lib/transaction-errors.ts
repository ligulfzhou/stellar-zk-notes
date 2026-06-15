import { scValToNative, xdr } from "@stellar/stellar-sdk";

type XdrEnumSwitch = { name?: string; value?: number } | number | unknown;

function switchName(switchVal: XdrEnumSwitch): string {
  if (
    switchVal &&
    typeof switchVal === "object" &&
    "name" in switchVal &&
    typeof (switchVal as { name?: string }).name === "string"
  ) {
    const name = (switchVal as { name: string }).name;
    if (name.length > 0) return name;
  }
  if (typeof switchVal === "number") {
    return String(switchVal);
  }
  return "unknown";
}

function operationResultDetail(opResult: xdr.OperationResult, index: number): string {
  const tr = opResult.tr();
  if (!tr) return `op${index}: no result`;

  const opSwitch = tr.switch();
  if (switchName(opSwitch) === "invokeHostFunction") {
    const hostResult = tr.invokeHostFunctionResult();
    return `op${index}: ${switchName(hostResult.switch())}`;
  }

  return `op${index}: ${switchName(opSwitch)}`;
}

function formatDiagnosticEvents(events?: xdr.DiagnosticEvent[]): string {
  if (!events?.length) return "";

  const parts: string[] = [];
  for (const event of events.slice(-4)) {
    try {
      const contractEvent = event.event();
      const body = contractEvent.body().switch();
      if (switchName(body) !== "v0") continue;
      const data = contractEvent.body().v0().data();
      const native = scValToNative(data);
      if (typeof native === "string" && native.trim()) {
        parts.push(native);
      } else if (native != null) {
        parts.push(JSON.stringify(native));
      }
    } catch {
      // ignore malformed diagnostic events
    }
  }

  return parts.length > 0 ? ` (${parts.join("; ")})` : "";
}

export function formatTransactionResult(errorResult: xdr.TransactionResult): string {
  const result = errorResult.result();
  const code = result.switch();
  const label = switchName(code);

  if (label !== "txFailed") {
    return label;
  }

  const ops = result.results() ?? [];
  if (ops.length === 0) {
    return "txFailed";
  }

  return `txFailed — ${ops.map(operationResultDetail).join("; ")}`;
}

export function formatSendTransactionError(
  result: {
    status: string;
    errorResult?: xdr.TransactionResult;
    diagnosticEvents?: xdr.DiagnosticEvent[];
  }
): string {
  if (result.errorResult) {
    return (
      formatTransactionResult(result.errorResult) +
      formatDiagnosticEvents(result.diagnosticEvents)
    );
  }
  return result.status;
}
