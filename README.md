# Gradual Chat

## 项目简介

Gradual Chat 是一个小型全栈聊天 assignment，使用 React、TypeScript、Vite、GraphQL Yoga、Socket.IO 和 MongoDB 构建。项目支持实时消息、Quote Reply，以及基于用户会话阅读位置的 Unread Count。

## 已实现功能

- 使用 Socket.IO 实时收发消息
- 使用 MongoDB 持久化聊天消息
- Quote Reply：回复指定消息、取消回复，并在消息中展示引用内容
- Unread Count：按用户和 conversation 保存阅读位置
- 打开 conversation 时加载最近的历史消息并自动 mark read
- 固定 User A / User B 身份和极简联系人列表
- frontend 与 backend unit test
- 使用一条命令同时启动 frontend 和 backend

## 技术栈

- Frontend：React、TypeScript、Vite
- Backend：TypeScript、GraphQL Yoga、Socket.IO
- Database：MongoDB
- Testing：Vitest、React Testing Library、jsdom

## 环境要求

- Node.js
- npm
- 可用的 MongoDB 实例

## 安装与环境配置

1. 安装依赖：

   ```bash
   npm install
   ```

2. 将 `.env.example` 复制为 `.env`，并按需调整配置。默认配置使用 `mongodb://127.0.0.1:27017`，数据库名称为 `gradual_chat`。

   PowerShell：

   ```powershell
   Copy-Item .env.example .env
   ```

   macOS/Linux：

   ```bash
   cp .env.example .env
   ```

3. 启动本地 MongoDB，或在 `.env` 中将 `MONGODB_URI` 设置为其他可用的 MongoDB 地址。

## 启动项目

使用以下命令同时启动 frontend 和 backend：

```bash
npm run dev:all
```

打开 [http://localhost:5173](http://localhost:5173)。Backend 运行在 `http://localhost:4000`，GraphQL 地址为 `http://localhost:4000/graphql`。

Backend 会自动加载 `.env`、连接 MongoDB，并启动 GraphQL 和 Socket.IO。Frontend 加载后会自动连接 Socket.IO；连接成功时，聊天页面顶部会显示 `Connected`。

需要单独调试时，仍可分别启动 frontend 和 backend：

```bash
npm run dev:frontend
npm run dev:server
```

## Quote Reply

发送回复时，frontend 会在请求中携带 `replyToMessageId`。Backend 会验证目标消息是否存在，并确认它属于当前 conversation，然后将 reply relationship 保存到 MongoDB。

GraphQL 和 Socket.IO 返回的消息中包含 `replyToMessageId` 以及 frontend 可直接渲染的 `replyTo { id, content }`。引用内容不会被拼接到新消息的 `content` 中。

## Unread Count

Unread Count 使用 `User + Conversation -> lastReadMessageId` 的阅读位置模型，而不是在每条消息上保存全局 `isRead` 或用户列表。

- 联系人页收到对方的新消息时，unread count 增加，但不会自动 mark read。
- 当前用户自己发送的消息不会计入自己的 unread count。
- 打开 conversation 后，阅读位置会推进到当前最新消息，unread count 清零。
- Conversation 已打开时，新 Socket.IO 消息会实时显示并自动 mark read。
- 较旧的 mark-read 请求不会使 `lastReadMessageId` 倒退。

## History Loading

点击联系人时，frontend 通过 GraphQL 查询固定 conversation 最近 50 条消息。Backend 按正确顺序返回完整 message 数据，包括 Quote Reply 所需字段。

History 与同时到达的 Socket.IO 消息按照 message id 去重，避免同一条消息重复显示。当前 scope 不包含 pagination、load more、infinite scroll 或 history search。

## Unit Tests

项目使用 Vitest 和 React Testing Library，共有 14 个测试：

- Frontend：9 个，覆盖 Quote Reply 交互、引用内容渲染、身份选择、联系人 unread badge、联系人页 Socket 行为、history 加载与去重、mark read，以及 Switch User。
- Backend：5 个，覆盖合法/非法 Quote Reply 校验、跨 conversation 校验、Unread Count 计算，以及阅读位置不可倒退规则。

这些测试不需要连接 MongoDB 或真实 Socket.IO server，不包含 browser E2E。

## 测试命令

运行全部 frontend 和 backend unit test：

```bash
npm test
```

分别运行 frontend 或 backend 测试：

```bash
npm run test:frontend
npm run test:server
```

其他常用命令：

```bash
npm run dev:all        # frontend + backend
npm run dev:frontend   # Vite only
npm run dev:server     # GraphQL/Socket.IO server only
npm run build          # frontend and backend production builds
npm run lint           # ESLint
npm test               # frontend and backend unit tests
```

## 当前项目限制

本项目刻意保持 assignment 所需的最小 scope：

- 只有两个固定 demo users：User A 和 User B
- 只有一个固定 conversation 和一个联系人项
- 当前身份保存在 `localStorage`，没有 authentication
- 没有 backend user account model、contacts database 或 friendship system
- 每次只加载最近 50 条 history，没有 pagination 或 infinite scroll
- 没有 Mention 或 notification system
- 没有 read receipts，也不展示“哪些用户已读”
- 没有 presence 或 typing indicator
- 没有 conversation creation、multi-conversation routing 或 thread tree
- 没有 browser E2E 或真实 MongoDB integration test
