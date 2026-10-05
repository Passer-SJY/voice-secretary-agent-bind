---
name: voice-secretary-bind
description: 使用 App 邀请和私有 Tailscale 接入服务，将随身录音绑定到当前飞书会话。用于安装和绑定；不能替换会话，也不能在配置时执行业务任务。
---

<p align="right"><strong>简体中文</strong> · <a href="SKILL.md">English</a></p>

# 将随身录音绑定到当前会话

版本 **1.0.0**，协议 **voice-secretary-session/v1**。安装前读取配套的
[配置指南](references/setup.zh_CN.md)。安装包包含本机回环服务；App 提示词不包含
飞书或 Gateway 密钥。

使用 App 邀请指定的仓库和准确 Git 提交。将该版本下载到独立目录，核对
`git rev-parse HEAD`，检查 skill 和脚本。将整个文件夹安装到此 Agent 工作区的
`skills/voice-secretary-bind`，保留已有安装。版本冲突应先核对升级，不能覆盖。
不能安装任务原文中任意代码；仓库链接不等于可信作者证明。

绑定的是**携带用户邀请的当前会话**。从可信入站消息和运行时元数据获取
`accountID`、`chatID`、`requesterID` 和 `sessionKey`。通过
`openclaw sessions --all-agents --json` 核对准确的会话 key。不能从显示名称推导、
默认使用 `main`、选择最近会话或替换会话。v1 要求独立飞书上下文，key 包含该
会话或发起人 ID；共享 main 会话和话题线程暂不支持。缺少元数据时说明缺失字段，
停止绑定。不能擅自修改全局会话路由；必要时请求用户决定局部路由调整。

检查 Node.js 22+、OpenClaw、Tailscale 和已有的内网 HTTPS Serve 配置。
主机与 iPhone 需要有授权的 Tailscale 连接，登录、共享或 ACL 更改可能需要用户
参与。不能在聊天中索取登录密钥，不能启用 Funnel、替换已有 Serve 入口或公开
Gateway。

将准确的邀请和可信上下文 JSON 保存到私有文件，按配置指南运行注册工具。
只向**发起本次邀请的会话**返回 JSON 回执，供用户粘贴到 App 核对并完成挑战交换。
这是短期配对凭证，不是 Gateway 密钥。群聊中明确说明回复和回执对群成员可见，
私密结果建议使用私聊。不能把配置完成说成回传测试已通过。

绑定服务必须由主机拥有者作为独立服务运行，不能继承 Agent exec 的执行身份。
App 绑定完成后，请用户主动启动飞书回传测试，再在当前会话追问以核验上下文。
业务任务只能由 App 明确确认对应版本后派发。绑定期间不能自动执行业务任务或
发起测试；缺少投递回执时标记未知，不能重放被中断的任务。

返回配置成功回执前，核对所有者管理的持久 Bridge 服务、非临时 Tailscale
身份/状态、本机健康检查及已有 HTTPS 入口。获得主机所有者授权后使用核对过的
`scripts/service.py` 工具，只能由独立系统管理器启动 Bridge，不能去掉 Agent
exec 子进程的执行身份绕过限制。
已有绑定升级保留状态和凭证，不需要新邀请或重新注册。无法访问主机进程
管理器时，应说明待部署，不能宣称配置成功。
