# Gradual Full-Stack Developer Assignment — Chat

这是 Gradual Full-Stack Developer Assignment 的双用户聊天实现。项目以 React、GraphQL、Socket.IO 和 MongoDB 构建；当前 V2 是基于 Gradual 提供的具体反馈和后续自查完成的一次系统性迭代。[原始题目](https://gradual.notion.site/Full-Stack-Developer-Assignment-8f1b586d55d142699266dce28a2a3a5f)与 [Figma 参考](https://www.figma.com/design/CBKcxWGEJGFe05ZsbgZZ2z/Full-Stack-Developer-Assignment)见链接。

## 功能与技术栈

- **聊天**：MongoDB 持久化、GraphQL 读写、Socket.IO 实时同步；乐观发送、失败重试、刷新后恢复最近 50 条消息。
- **交互**：真实时间、Enter 发送、输入校验、真实联系人及最新可见消息预览；消息 hover/focus 时可 Quote，自己的已发送消息可 Hide for me。
- **扩展**：Quote Reply、`@User A/B` Mention 高亮、按用户保存的未读/已读位置，以及不删除原消息的个人隐藏记录。
- **演示身份**：右上头像菜单切换 User A / User B；每个浏览器标签通过 `sessionStorage` 独立保存身份。
- **技术**：前端 React + TypeScript + Vite；后端 GraphQL Yoga + Socket.IO + MongoDB；测试使用 Vitest、React Testing Library 和 jsdom。

## V2 相比初始版本的改进

初始提交已具备基础 MongoDB、GraphQL、Socket.IO、Quote Reply 和 Unread Count。V2 保留这些链路，并针对反馈完善界面与边界情况：

| 初始版本 | V2 |
| --- | --- |
| 消息时间统一显示 `now`；会话信息较简化 | 显示真实消息时间、联系人身份、最新可见消息预览及其时间；界面进一步贴近 Figma |
| 主要通过按钮发送，输入边界处理有限 | Enter 发送、空白和长度校验、加载/错误/空状态、失败重试 |
| 基础 Reply 入口 | hover/focus Quote 与引用草稿；增加 Mention 和按用户持久化的 Hide for me |
| 独立的 demo 用户切换，身份使用 `localStorage` | 头像下拉菜单；`sessionStorage` 保证双标签身份隔离 |
| 以正常发送路径为主，14 个单元测试 | 加强重复提交保护、消息 ID 幂等重试、断线重连补历史、过期请求隔离及未读状态处理；44 个前后端回归测试 |

隐藏只影响当前用户的历史和预览：MongoDB 中原消息保留，对方仍可见；引用隐藏消息时显示 `Message hidden`。顶部使用 [Gradual Community 页面](https://community.gradual.com/)所引用的绿色图标，文件保存在 `public/gradual-green-icon.png`。

## 安装与运行

需要 Node.js、npm 和可用的 MongoDB。先安装依赖，将 `.env.example` 复制为 `.env`，然后启动：

```bash
npm install
cp .env.example .env
npm run dev:all
```

Windows PowerShell 可用 `Copy-Item .env.example .env`。默认前端为 [http://localhost:5173](http://localhost:5173)，GraphQL 为 `http://localhost:4000/graphql`。`.env.example` 中的 `MONGODB_URI` 默认指向本机 MongoDB；还可配置数据库名 `MONGODB_DB_NAME`、后端端口 `PORT`、前端地址 `CLIENT_ORIGIN` 和前端连接地址 `VITE_SOCKET_URL`。

## 测试与检查

```bash
npm test             # 前端 32 项 + 后端 12 项
npm run build        # 前后端构建
npm run lint         # ESLint
git diff --check
```

自动化测试覆盖发送、Quote、Mention、隐藏、未读、预览、Socket 去重、重试、幂等及身份/请求竞态。测试使用模拟数据库；真实 MongoDB 和双用户浏览器流程已做过人工验收，但没有纳入可重复运行的自动化 E2E。

## 当前范围与限制

- 固定 User A / User B 和一条 DM 会话；没有真实认证或联系人系统。
- 每次加载最近 50 条消息；没有分页、搜索或通知。
- Mention 仅覆盖两名演示用户；没有 presence、typing indicator 或 read receipts。
