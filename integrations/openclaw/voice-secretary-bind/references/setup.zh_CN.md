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
`bridge.lock`，按下方安全恢复规则处理。不能删除请求日志。
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


## 持久服务与已有绑定升级

Bridge 与 Tailscale 应运行在长期在线的 OpenClaw 主机上，不能依赖短命的 Agent
shell/容器。Tailscale 守护进程的状态与节点身份必须跨重启保存；临时或已删除
节点不适合持久绑定。Tailscale 节点离线属于主机网络状态，与回环 Bridge 进程
停止不同；手机断线本身不会停止这两个独立主机服务。

安装包现提供主机所有者执行的服务工具。在已安装 skill 目录中先准备配置供所有者核对：

```bash
python3 scripts/service.py
# 检查私有生成的 unit/plist 与路径，再安装：
python3 scripts/service.py --apply
```

原安装使用定制路径时，指定 `--node /绝对路径/node`、
`--openclaw /绝对路径/openclaw`、`--state` 和 `--port`。必须沿用原绑定的状态
目录和端口。工具不会注册新绑定、修改 Tailscale、改变凭证、停止现有服务或
覆盖不同的服务配置。它设置私有目录权限和明确的可执行路径。Linux 使用有
自动重启的 systemd 用户服务；macOS 使用 KeepAlive LaunchAgent。Linux 无
登录开机运行需要所有者启用用户 lingering（该用户的 `loginctl enable-linger`），
先核对策略再修改。LaunchAgent 在用户登录后启动；主机休眠或关机仍不可用。
容器需要持久状态卷和 Agent 回合外的进程管理器，不能假设容器有用户 systemd。

Linux 用 `systemctl --user status voice-secretary-bridge` 查看服务；macOS 用
`launchctl print gui/$(id -u)/org.folotoy.voice-secretary-bridge`。检查本机
`http://127.0.0.1:8765/health`（按实际端口调整），再核对已有 Serve HTTPS
入口。`/health` 只公开服务就绪与版本，不包含身份或凭证，也不证明飞书回传。
Tailscale `serve --bg` 会保留配置，但不能让已经停止的守护进程或 Bridge 运行。

启动时，只有明确确认 `bridge.lock` 中 PID 已不存在，才自动替换遗留锁；
存活、不可检查或格式错误的拥有者仍保留。启动替换通过 `bridge-startup.guard`
串行化；极短启动临界区内崩溃留下的 guard 需要所有者核对。不能删除请求
日志；恢复后的未完成请求仍为 `outcome_unknown`，不会重放。升级或停止前
先核对活动任务，并保留原绑定、状态路径、HTTPS 域名、端口和凭证。

iPhone 可在 Tailscale 设置开启
[VPN On Demand](https://tailscale.com/docs/features/client/ios-vpn-on-demand)
自动连接。Wi-Fi/蜂窝 Always 规则或支持的 `.ts.net` 域名匹配可减少手动重连。
App 无法覆盖手动禁用的 VPN 或其他正在运行的 VPN。连接恢复后，任务“重试”
先查询原 UUID；只有原绑定核验通过且请求不存在时，才用同 UUID/内容恢复
派发。已接收或结果不明的任务不重跑；确定失败则生成需核对的重试草稿。

核对活动任务后，已有服务需明确重启才会加载升级代码：
`systemctl --user restart voice-secretary-bridge`，或
`launchctl kickstart -k gui/$(id -u)/org.folotoy.voice-secretary-bridge`。
原 Bridge 若在前台运行，先正常停止确认过的该进程，再安装进程管理器。
不能停止不相关的 Node/OpenClaw 进程。

Agent exec 中的安装工具可以准备配置；获得明确主机所有者授权后，可以使用
`--apply --owner-approved` 请求独立的系统进程管理器启动服务。安装器不会将
Bridge 作为自己的子进程运行，也不会删除 `OPENCLAW_SHELL`；新服务归系统
管理器所有。没有可用的独立进程管理器时，应停止并说明缺少主机部署条件。

没有 systemd 用户实例的 Docker 使用[专用容器方案](docker.zh_CN.md)；apply 现在先检查管理器可用性，再安装文件。
