<p align="right"><strong>简体中文</strong> · <a href="README.md">English</a></p>

# 随身录音会话绑定

[voice-secretary-bind](integrations/openclaw/voice-secretary-bind/SKILL.zh_CN.md) 是可下载的 OpenClaw
skill 和私有 Tailscale 接入服务，版本 1.0.0。将 App 任务绑定到现有飞书会话，
沿用该会话的 OpenClaw 上下文。

阅读[安装与运行](integrations/openclaw/voice-secretary-bind/references/setup.zh_CN.md)，使用 Node.js 22+
运行无第三方依赖的协议测试：

```bash
node --test integrations/openclaw/tests/bridge.test.mjs
```

在 AI Passport 开发工作区，通过 `python3 tools/package_vs_agent_skill.py` 创建
纯源代码安装包，包含完整 skill、MIT 许可和逐文件 SHA-256 清单，不包含运行状态
或凭证。

App 生成 30 分钟邀请，再导入目标飞书会话返回的 JSON 回执，通过 HTTPS 挑战
交换获取每个绑定独立的凭证并保存到 Keychain。派发使用持久化请求 ID、准确的
会话路由，分别记录执行和消息投递结果。

模拟协议测试不能代替真实 OpenClaw 安装、tailnet 连接、飞书投递或上下文追问
验收，这些仍需实测。仓库发布和主机服务安装与本地编译验证分别进行。
