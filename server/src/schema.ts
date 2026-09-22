import { createSchema } from "graphql-yoga";
import { GraphQLError } from "graphql";

import type { GraphQLContext } from "./context.js";
import { getDatabase } from "./database.js";
import {
  isReplyTargetValid,
  shouldAdvanceReadCursor,
} from "./messageRules.js";

const demoConversationId = "share-your-story";

export const schema = createSchema<GraphQLContext>({
  typeDefs: /* GraphQL */ `
    type Query {
      health: String!
      conversationReadState(
        userId: ID!
        conversationId: ID!
      ): ConversationReadState!
      messages(conversationId: ID!): [Message!]!
    }
    type Message {
      id: ID!
      conversationId: ID!
      senderId: ID!
      content: String!
      status: String!
      replyToMessageId: ID
      replyTo: Message
    }
    type ConversationReadState {
      conversationId: ID!
      lastReadMessageId: ID
      latestMessageId: ID
      unreadCount: Int!
    }
    type Mutation {
      sendMessage(
        id: ID!
        conversationId: ID!
        senderId: ID!
        content: String!
        replyToMessageId: ID
      ): Message!
      markConversationRead(
        userId: ID!
        conversationId: ID!
        lastReadMessageId: ID!
      ): ConversationReadState!
    }
  `,
  resolvers: {
    Query: {
      health: () => "ok",
      conversationReadState: async (_, args) => {
        return getConversationReadState(args.userId, args.conversationId);
      },
      messages: async (_, args) => {
        if (args.conversationId !== demoConversationId) {
          throw new GraphQLError("Conversation was not found.", {
            extensions: { code: "BAD_USER_INPUT" },
          });
        }

        const db = getDatabase();
        const newestMessages = await db
          .collection("messages")
          .find({ conversationId: args.conversationId })
          .sort({ _id: -1 })
          .limit(50)
          .toArray();
        const orderedMessages = newestMessages.reverse();
        const replyTargetIds = orderedMessages.flatMap((message) =>
          message.replyToMessageId ? [message.replyToMessageId] : [],
        );
        const replyTargets = replyTargetIds.length
          ? await db
              .collection("messages")
              .find({ id: { $in: replyTargetIds } })
              .toArray()
          : [];
        const replyTargetsById = new Map(
          replyTargets.map((message) => [message.id, message]),
        );

        return orderedMessages.map((message) => {
          const replyTarget = message.replyToMessageId
            ? replyTargetsById.get(message.replyToMessageId)
            : null;

          return {
            ...message,
            senderId: message.senderId ?? "unknown-user",
            status: message.status ?? "sent",
            replyTo: replyTarget
              ? {
                  ...replyTarget,
                  senderId: replyTarget.senderId ?? "unknown-user",
                  status: replyTarget.status ?? "sent",
                }
              : null,
          };
        });
      },
    },
    Mutation: {
      sendMessage: async (_, args, context) => {
        const db = getDatabase();
        let replyTo: {
          id: string;
          conversationId: string;
          senderId: string;
          content: string;
          status: string;
        } | null = null;

        if (args.replyToMessageId) {
          const replyTarget = await db.collection("messages").findOne({
            id: args.replyToMessageId,
          });

          if (!isReplyTargetValid(replyTarget, args.conversationId)) {
            throw new GraphQLError(
              "Reply target was not found in this conversation.",
              { extensions: { code: "BAD_USER_INPUT" } },
            );
          }

          replyTo = {
            id: replyTarget.id,
            conversationId: replyTarget.conversationId,
            senderId: replyTarget.senderId ?? "unknown-user",
            content: replyTarget.content,
            status: replyTarget.status,
          };
        }

        const message = {
          id: args.id,
          conversationId: args.conversationId,
          senderId: args.senderId,
          content: args.content,
          status: "sent",
          replyToMessageId: args.replyToMessageId ?? null,
        };

        await db.collection("messages").insertOne(message);

        const messageResponse = { ...message, replyTo };

        // Broadcast only after persistence succeeds.
        context.io.emit("messageCreated", messageResponse);

        return messageResponse;
      },
      markConversationRead: async (_, args) => {
        const db = getDatabase();
        const message = await db.collection("messages").findOne({
          id: args.lastReadMessageId,
          conversationId: args.conversationId,
        });

        if (!message) {
          throw new GraphQLError(
            "Last-read message was not found in this conversation.",
            { extensions: { code: "BAD_USER_INPUT" } },
          );
        }

        const readStates = db.collection("conversationReadStates");
        const currentReadState = await readStates.findOne({
          userId: args.userId,
          conversationId: args.conversationId,
        });
        const shouldAdvance = shouldAdvanceReadCursor(
          currentReadState?.lastReadMessageObjectId?.toString() ?? null,
          message._id.toString(),
        );

        if (shouldAdvance) {
          await readStates.updateOne(
            {
              userId: args.userId,
              conversationId: args.conversationId,
            },
            {
              $set: {
                lastReadMessageId: message.id,
                lastReadMessageObjectId: message._id,
                updatedAt: new Date(),
              },
            },
            { upsert: true },
          );
        }

        return getConversationReadState(args.userId, args.conversationId);
      },
    },
  },
});

async function getConversationReadState(
  userId: string,
  conversationId: string,
) {
  const db = getDatabase();
  const [readState, latestMessage] = await Promise.all([
    db.collection("conversationReadStates").findOne({
      userId,
      conversationId,
    }),
    db.collection("messages").findOne(
      { conversationId },
      { sort: { _id: -1 } },
    ),
  ]);

  const unreadFilter = {
    conversationId,
    senderId: { $ne: userId },
    ...(readState?.lastReadMessageObjectId
      ? { _id: { $gt: readState.lastReadMessageObjectId } }
      : {}),
  };
  const unreadCount = await db
    .collection("messages")
    .countDocuments(unreadFilter);

  return {
    conversationId,
    lastReadMessageId: readState?.lastReadMessageId ?? null,
    latestMessageId: latestMessage?.id ?? null,
    unreadCount,
  };
}
