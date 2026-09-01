export type OfflineCommandStatus = "PENDING" | "CONFLICT";

export interface OfflineCommand {
  readonly commandId: string;
  readonly scope: string;
  readonly path: string;
  readonly body: Readonly<Record<string, unknown>>;
  readonly label: string;
  readonly createdAt: string;
  readonly status: OfflineCommandStatus;
  readonly error: string | null;
}

const DATABASE_NAME = "dart-ost-offline";
const STORE_NAME = "commands";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error ?? new Error("Offline-Speicher ist nicht verfügbar.")));
  });
}

async function database(): Promise<IDBDatabase> {
  const request = indexedDB.open(DATABASE_NAME, 1);
  request.addEventListener("upgradeneeded", () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) {
      const store = request.result.createObjectStore(STORE_NAME, { keyPath: "commandId" });
      store.createIndex("scope", "scope", { unique: false });
    }
  });
  return requestResult(request);
}

export async function saveOfflineCommand(command: OfflineCommand): Promise<void> {
  const db = await database();
  const transaction = db.transaction(STORE_NAME, "readwrite");
  await requestResult(transaction.objectStore(STORE_NAME).put(command));
  db.close();
}

export async function listOfflineCommands(scope: string): Promise<readonly OfflineCommand[]> {
  const db = await database();
  const transaction = db.transaction(STORE_NAME, "readonly");
  const commands = await requestResult(transaction.objectStore(STORE_NAME).index("scope").getAll(scope)) as OfflineCommand[];
  db.close();
  return commands.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function removeOfflineCommand(commandId: string): Promise<void> {
  const db = await database();
  const transaction = db.transaction(STORE_NAME, "readwrite");
  await requestResult(transaction.objectStore(STORE_NAME).delete(commandId));
  db.close();
}

export async function removeOfflineCommandsForScope(scope: string): Promise<number> {
  const commands = await listOfflineCommands(scope);
  await Promise.all(commands.map((command) => removeOfflineCommand(command.commandId)));
  return commands.length;
}

export async function markOfflineCommandConflict(command: OfflineCommand, message: string): Promise<void> {
  await saveOfflineCommand({ ...command, status: "CONFLICT", error: message });
}
