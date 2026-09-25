import { createSchema } from "graphql-yoga";
import { GraphQLError } from "graphql";
import { MongoServerError } from "mongodb";

import type { GraphQLContext } from "./context.js";
import { getDatabase } from "./database.js";
import {
  getMentionedUserIds,
  isReplyTargetValid,
  normalizeMessageContent,
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
      messages(conversationId: ID!, userId: ID!): [Message!]!
    }
    type Message {
      id: ID!
      conversationId: ID!
      senderId: ID!
      content: String!
      createdAt: String!
      mentionedUserIds: [ID!]!
      status: String!
      replyToMessageId: ID
      replyTo: Message
    }
    type ConversationReadState {
      conversationId: ID!
      lastReadMessageId: ID
      latestMessageId: ID
      latestMessage: ConversationLatestMessage
      unreadCount: Int!
      hiddenMessageIds: [ID!]!
    }
    type ConversationLatestMessage {
      id: ID!
      senderId: ID!
      content: String!
      createdAt: String!
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
      hideMessageForMe(
        userId: ID!
        conversationId: ID!
        messageId: ID!
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
        if (args.conversationId !== demoConversationId || !isDemoUser(args.userId)) {
          throw new GraphQLError("Conversation was not found.", {
            extensions: { code: "BAD_USER_INPUT" },
          });
        }

        const db = getDatabase();
        const hiddenMessageIds = await getHiddenMessageIds(args.userId, args.conversationId);
        const newestMessages = await db
          .collection("messages")
          .find({ conversationId: args.conversationId, id: { $nin: hiddenMessageIds } })
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
          const replyTarget = message.replyToMessageId && !hiddenMessageIds.includes(message.replyToMessageId)
            ? replyTargetsById.get(message.replyToMessageId)
            : null;

          return {
            ...message,
            createdAt:
              message.createdAt ?? message._id.getTimestamp().toISOString(),
            mentionedUserIds:
              message.mentionedUserIds ?? getMentionedUserIds(message.content),
            senderId: message.senderId ?? "unknown-user",
            status: message.status ?? "sent",
            replyTo: replyTarget
              ? {
                  ...replyTarget,
                  createdAt:
                    replyTarget.createdAt ??
                    replyTarget._id.getTimestamp().toISOString(),
                  mentionedUserIds:
                    replyTarget.mentionedUserIds ??
                    getMentionedUserIds(replyTarget.content),
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
        const content = normalizeMessageContent(args.content);
        if (
          !content ||
          args.conversationId !== demoConversationId ||
          !["demo-user-a", "demo-user-b"].includes(args.senderId) ||
          !args.id ||
          args.id.length > 100
        ) {
          throw new GraphQLError("Invalid message or conversation.", {
            extensions: { code: "BAD_USER_INPUT" },
          });
        }

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
          content,
          createdAt: new Date().toISOString(),
          mentionedUserIds: getMentionedUserIds(content),
          status: "sent",
          replyToMessageId: args.replyToMessageId ?? null,
        };

        const messages = db.collection("messages");
        let inserted = false;
        try {
          const result = await messages.updateOne(
            { id: message.id },
            { $setOnInsert: message },
            { upsert: true },
          );
          inserted = result.upsertedCount === 1;
        } catch (error) {
          if (!(error instanceof MongoServerError) || error.code !== 11000) {
            throw error;
          }
          // Another request with this ID won the insert race.
        }
        const persisted = await messages.findOne({ id: message.id });
        if (
          !persisted ||
          persisted.conversationId !== message.conversationId ||
          persisted.senderId !== message.senderId ||
          persisted.content !== message.content ||
          (persisted.replyToMessageId ?? null) !== message.replyToMessageId
        ) {
          throw new GraphQLError("Message ID is already in use.", {
            extensions: { code: "BAD_USER_INPUT" },
          });
        }
        const messageResponse = {
          ...persisted,
          createdAt:
            persisted.createdAt ?? persisted._id.getTimestamp().toISOString(),
          mentionedUserIds:
            persisted.mentionedUserIds ?? getMentionedUserIds(persisted.content),
          replyTo,
        };

        if (inserted) {
          context.io.emit("messageCreated", messageResponse);
        }

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
      hideMessageForMe: async (_, args) => {
        if (!isDemoUser(args.userId) || args.conversationId !== demoConversationId) {
          throw new GraphQLError("Invalid user or conversation.", {
            extensions: { code: "BAD_USER_INPUT" },
          });
        }
        const db = getDatabase();
        const message = await db.collection("messages").findOne({
          id: args.messageId,
          conversationId: args.conversationId,
        });
        if (!message || message.senderId !== args.userId) {
          throw new GraphQLError("Only your own message can be hidden for you.", {
            extensions: { code: "BAD_USER_INPUT" },
          });
        }
        await db.collection("hiddenMessages").updateOne(
          { userId: args.userId, conversationId: args.conversationId, messageId: args.messageId },
          { $setOnInsert: { userId: args.userId, conversationId: args.conversationId, messageId: args.messageId, createdAt: new Date() } },
          { upsert: true },
        );
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
  const hiddenMessageIds = await getHiddenMessageIds(userId, conversationId);
  const [readState, latestMessage] = await Promise.all([
    db.collection("conversationReadStates").findOne({
      userId,
      conversationId,
    }),
    db.collection("messages").findOne(
      { conversationId, id: { $nin: hiddenMessageIds } },
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
    latestMessage: latestMessage
      ? {
          id: latestMessage.id,
          senderId: latestMessage.senderId ?? "unknown-user",
          content: latestMessage.content,
          createdAt:
            latestMessage.createdAt ?? latestMessage._id.getTimestamp().toISOString(),
        }
      : null,
    unreadCount,
    hiddenMessageIds,
  };
}

function isDemoUser(userId: string): boolean {
  return userId === "demo-user-a" || userId === "demo-user-b";
}

async function getHiddenMessageIds(userId: string, conversationId: string): Promise<string[]> {
  const hidden = await getDatabase().collection("hiddenMessages")
    .find({ userId, conversationId }).toArray();
  return hidden.map((item) => item.messageId as string);
}
