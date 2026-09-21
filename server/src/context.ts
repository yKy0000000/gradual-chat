import type { Server as SocketIOServer } from "socket.io";

export type GraphQLContext = {
  io: SocketIOServer;
};
