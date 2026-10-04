<p align="right"><strong>简体中文</strong> · <a href="setup.md">English</a></p>

# 安装与运行

这是独立分发的源代码安装包。使用下载提示词前，在 App 填写实际
已发布的仓库和 40 位固定提交。下载内容必须包含完整 skill 目录。

## 环境与身份

使用 Node.js 22+，以及已安装并有可用飞书账号的 OpenClaw Gateway。
检查 `openclaw agent --help` 包含 `--session-key`、`--message-file`、`--deliver`、
`--reply-channel`、`--reply-account`、`--reply-to`、`--json` 和 `--timeout`。
不支持的版本需要核对后升级。返回 JSON 缺少 `deliveryStatus` 时仍标记投递未知，
不能仅凭退出状态证明发送成功。

将可信当前消息元数据保存到私有的 `context.json`：

```json
{
  "accountID": "configured-feishu-account",
  "chatID": "oc_actual_chat",
  "requesterID": "ou_actual_sender",
  "sessionKey": "agent:actual-agent:feishu:direct:ou_actual_sender"
}
```

示例 key 仅作说明，必须复制实际运行时 key。用
`openclaw sessions --all-agents --json` 验证存在；列表分页可能需要支持更大查询
上限的兼容 CLI。服务不会猜测 key。私聊隔离需检查拥有者的会话路由，共享 main
私聊上下文不满足按会话隔离要求。话题线程暂缓支持。普通群聊向该群投递，群成员
可见；发起人 ID 记录是谁绑定，不代表改为向其私信投递。

## Tailscale 与服务

先检查 `tailscale status` 和 `tailscale serve status`。iPhone 必须安装 Tailscale、
完成登录并连接，有权访问该主机。使用未占用的 Serve HTTPS 端口，不要重置现有
Serve 配置。例如未使用 8443 时，可执行：

```bash
tailscale serve --bg --https=8443 http://127.0.0.1:8765
```

复制实际公布的域名，App 地址类似 `https://host.tailnet.ts.net:8443/v1`。
需要 MagicDNS/HTTPS 和 tailnet ACL 支持；该命令不启用公网 Funnel。
从 [官方入口](https://tailscale.com/download) 安装 Tailscale，本安装包不包含它。

将准确的 App 邀请保存为私有 `invitation.json`。在 skill 目录运行：

```bash
node scripts/bridge.mjs register invitation.json context.json https://host.tailnet.ts.net:8443/v1
```

把 stdout 返回的完整 JSON 发回原飞书会话。保持文件私有，不能贴到公开 issue。
服务状态默认在 `~/.voice-secretary-bind`，可通过 `VS_BIND_STATE` 指定其他私有目录。
Node 创建 0700 状态目录和 0600 日志、凭证文件；目录不能放进仓库。
邀请包含 `challengeHash`（私有挑战文本的 SHA-256），不包含秘密。iPhone 将秘密
留在 Keychain，因此查看群提示词和回执不会获得派发凭证。每个邀请只注册一个绑定。同一挑战在过期前重试交换只返回同一个绑定凭证，用于
恢复丢失的 HTTPS 响应。

由主机拥有者使用常规进程管理器启动服务，使用拥有该会话的 OpenClaw 配置和 PATH：

```bash
node scripts/bridge.mjs serve
```

只监听 `127.0.0.1:8765`。用 `VS_BIND_PORT` 改本地端口时同步调整 Serve。
Linux 使用用户 systemd 服务，macOS 使用 LaunchAgent，配置绝对 Node/脚本路径
和明确 PATH。创建服务遵守主机拥有者授权；服务不能继承 `OPENCLAW_SHELL=exec`，
不能通过移除 Agent 子进程身份绕过 OpenClaw 限制。应使用独立于当前执行轮次的
主机拥有者服务，不需要 root Gateway 或修改 Gateway 密钥。

服务运行时可以注册绑定。正常 SIGTERM 会等待活动请求；突然崩溃会留下
`bridge.lock`，确认没有进程拥有该状态目录后，仅删除此锁。不能删除请求日志。
重启后未结束的请求转为 `outcome_unknown`，不再执行。

## 任务与投递语义

App 使用每个绑定独立的凭证。`GET /v1/bindings/:id` 核对身份、不发送消息；
`POST /v1/pair` 交换未过期且匹配的邀请挑战和配对凭证。任务使用
`POST /v1/bindings/:id/runs`，携带 `Idempotency-Key` UUID、协议版本、冻结的
`binding`、`task_id`、`revision` 和 `input`。可选 `probe: true` 只运行绑定测试。
通过 `GET /v1/bindings/:id/runs/:requestUUID` 查询。

执行前持久化 UUID 和完整载荷指纹。同一 UUID 同内容返回已有回执，不同内容返回
409。同一会话的并行接入请求会被拒绝。实际调用为
`openclaw agent --session-key ... --message-file ... --deliver --reply-channel
feishu --reply-account ... --reply-to chat:... --json`。OpenClaw 原生路由负责之后的
飞书消息和 `/new`；绑定 key 不存在时停止核对，不能分配替代会话。每次派发前
检查会话存在，路由变更需重新绑定。

执行与投递独立。文字结果可以已经返回，而飞书投递失败或未知。不会自动重放
任务或消息；App 保留结果副本。真实验收需要测试回复和飞书追问。仅媒体、部分
或不完整回执需人工核对。本轮服务日志持续保留；长期发布前需约定主机存储保留
和导出策略。App 删除只移除本机凭证，远端撤销需先核对活动请求、停止服务，
然后移除对应绑定文件；自动远端撤销暂缓实现。

官方参考：[Agent CLI](https://docs.openclaw.ai/cli/agent)、
[会话 CLI](https://docs.openclaw.ai/cli/sessions)、
[飞书](https://docs.openclaw.ai/channels/feishu)、
[Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)。
