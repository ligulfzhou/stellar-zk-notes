import {
  getAddress,
  isConnected,
  requestAccess,
} from "@stellar/freighter-api";

export async function connectFreighter(): Promise<string> {
  const connection = await isConnected();
  if (!connection.isConnected) {
    throw new Error(connection.error ?? "Freighter extension not found");
  }

  const access = await requestAccess();
  if (access.error) {
    throw new Error(access.error);
  }

  const address = await getAddress();
  if (address.error || !address.address) {
    throw new Error(address.error ?? "Failed to read Freighter address");
  }

  return address.address;
}

export async function getPublicKey(): Promise<string | null> {
  const address = await getAddress();
  if (address.error || !address.address) {
    return null;
  }
  return address.address;
}
