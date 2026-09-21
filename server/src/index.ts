import "dotenv/config";

import { createServer } from "node:http";
import { createYoga } from "graphql-yoga";
import { Server as SocketIOServer } from "socket.io";

import type { GraphQLContext } from "./context.js";
import { connectToDatabase } from "./database.js";
import { schema } from "./schema.js";

const port = Number.parseInt(process.env.PORT ?? "4000", 10);
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";

const yoga = createYoga({
  schema,
  graphqlEndpoint: "/graphql",
  context: createGraphQLContext,
});

const server = createServer(yoga);

const socketServer = new SocketIOServer(server, {
  cors: {
    origin: clientOrigin,
    methods: ["GET", "POST"],
  },
});

function createGraphQLContext(): GraphQLContext {
  return { io: socketServer };
}

async function startServer() {
  await connectToDatabase();
  server.listen(port);
}

startServer().catch((error: unknown) => {
  console.error("Failed to start server:", error);
  process.exitCode = 1;
});
