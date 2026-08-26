# Joker CLI

Joker 的终端编码代理 —— 参照 [openai/codex](https://github.com/openai/codex) 与
[xai-org/grok-build](https://github.com/xai-org/grok-build) 的产品形态，
但**完全复用 Joker 现有 runtime**（`server/` 的 agent loop、工具、权限审批、
usage 遥测与 HTTP/SSE 契约），不引入第二套运行时。

## 安装 / 构建

```sh
# 在仓库根目录
npm run build --workspace @joker-code/joker-cli

# 本地链接后使用 `joker` 命令
npm link --workspace @joker-code/joker-cli
joker --version 2>/dev/null || joker help
```

CLI 启动时会自动探测并拉起 Joker server（优先 `dist-server-bundle/index.cjs`，
其次 `dist-server/index.js`，源码环境回退到 `npm run server:dev`）；如果已有
server 在运行则直接 attach。CLI 拉起的 server 是 detached 守护进程，日志写入
`.cache/joker-cli-server.log`，其 local API token 持久化在
`~/.joker/server-tokens.json`（0600），后续调用自动读取以完成认证。

## 使用

```sh
joker                          # 交互式会话（REPL）
joker exec "修复登录页的空指针"   # headless 一次性执行（脚本 / CI）
joker exec "跑测试" --json      # JSONL 事件流（稳定契约）
joker exec "重构" --yes        # 自动批准工具调用（默认拒绝）
joker status                   # runtime 健康
joker tools                    # 已注册工具列表
joker audit 50                 # 最近审计事件
```

全局选项：

| 选项 | 说明 |
|------|------|
| `--project <path>` | 项目根目录（默认 cwd） |
| `--mode <mode>` | `default` / `plan` / `workspace_write` / `full_access`（别名 `yolo`） |
| `--model <id>` | 模型覆盖 |
| `--thinking <mode>` | `fast` / `balanced` / `deep` |
| `--url <url>` | attach 到已运行的 server |
| `--token <token>` | Local API token（或 `AGENT_LOCAL_TOKEN` 环境变量） |
| `--no-start-server` | 只 attach，不自动拉起 |

配置按 `默认值 → ~/.joker/config.json → 环境变量 → 命令行参数` 合并。

## exec 退出码契约

| 退出码 | 含义 |
|--------|------|
| `0` | 完成 |
| `1` | 运行错误 |
| `2` | 需要审批但被拒绝（headless 默认 deny） |

## 架构

```
src/
  cli.ts       # bin 入口
  main.ts      # 参数解析 + 子命令分发
  config.ts    # 分层配置解析
  serverProcess.ts  # server 探测 / 拉起（复用同一 runtime，不内嵌副本）
  client.ts    # /api/agent/run、/api/agent/approve 的 SSE 客户端
  session.ts   # REPL：流式渲染 + 交互式审批门
  exec.ts      # headless 模式（CI 友好退出码）
  render.ts    # Session / Quiet / Jsonl 三种渲染器
  commands.ts  # status / tools / audit 只读子命令
```

与 GUI 共享同一套事件契约（`StreamEvent`），审批走同一个
`approval_required → /api/agent/approve` 流程。
