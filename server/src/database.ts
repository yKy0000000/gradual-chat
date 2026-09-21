import { Db, MongoClient } from "mongodb";

let client: MongoClient | undefined;
let database: Db | undefined;

export async function connectToDatabase(): Promise<Db> {
  if (database) {
    return database;
  }

  const uri = process.env.MONGODB_URI;
  const databaseName = process.env.MONGODB_DB_NAME ?? "gradual_chat";

  if (!uri) {
    throw new Error("MONGODB_URI is not configured");
  }

  client = new MongoClient(uri);
  await client.connect();
  database = client.db(databaseName);

  return database;
}

export function getDatabase(): Db {
  if (!database) {
    throw new Error("MongoDB has not been connected");
  }

  return database;
}

export async function disconnectFromDatabase(): Promise<void> {
  await client?.close();
  client = undefined;
  database = undefined;
}
