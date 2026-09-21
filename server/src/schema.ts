import { createSchema } from "graphql-yoga";

import type { GraphQLContext } from "./context.js";
import { getDatabase } from "./database.js";

export const schema = createSchema<GraphQLContext>({
  typeDefs: /* GraphQL */ `
    type Query {
      health: String!
    }
    type Message {
      id: ID!
      content: String!
      status: String!
    }
    type Mutation {
      sendMessage(id: ID!, content: String!): Message!
    }
  `,
  resolvers: {
    Query: {
      health: () => "ok",
    },
    Mutation: {
      sendMessage: async (_, args, context) => {
        const message = {
          id: args.id,
          content: args.content,
          status: "sent",
        };

        const db = getDatabase();
        await db.collection("messages").insertOne(message);

        // Broadcast only after persistence succeeds.
        context.io.emit("messageCreated", message);

        return message;
      },
    },
  },
});
