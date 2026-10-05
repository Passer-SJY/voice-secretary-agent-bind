<p align="right"><strong>简体中文</strong> · <a href="docker.md">English</a></p>

# 无 systemd 的 Docker 恢复

原 OpenClaw 容器有 tini、没有 systemd 用户实例时使用本方案，不能在其中运行
`service.py --apply`。准备两个独立 Compose 服务：Bridge 使用核验过的原
OpenClaw 镜像/配置，userspace Tailscale 使用显式核验过的固定版本。每个进程
都是对应容器的主服务，设置 `restart: unless-stopped`，共享原 Gateway 网络
命名空间。不替换 Gateway，不添加公网端口、登录密钥、Funnel 或重新注册。

## 所有者预检

必须有 Docker 宿主入口和原 Compose 项目；仅在容器内部的 Agent 没有授权宿主
工具时不能部署。不要为绕过条件开放 Docker socket。先识别原 Compose 服务名、
准确镜像、原数字 UID:GID/HOME、Node/OpenClaw 路径、`.openclaw` 持久挂载的
实际宿主来源及原 Tailscale 状态文件名，不能输出容器环境或状态内容。

核验 Bridge 镜像实际包含兼容 CLI 和 Node22+；只安装在旧容器 overlay 的程序
不在镜像中。核验 Tailscale 镜像包含 `/usr/local/bin/tailscaled` 和兼容版本。
缺少程序时先构建核验过的镜像。定制 OpenClaw profile/config 环境经所有者核对
后保留在生成的私有服务配置中，业务派发前核对原 session 存在。

## 停止、复制和核验

先对账活动任务，再正常停止确认过的原 Bridge 和 Tailscale 守护进程；不能停止
无关进程，也不能让两个守护进程使用相同节点身份。保留原文件用于恢复。
在原容器内，用实际路径执行：

```bash
python3 scripts/container.py migrate \
  --bridge-state /实际/原桥接状态目录 \
  --tailscale-state /实际/原tailscale状态文件 \
  --mount-root /实际/已有持久挂载 \
  --destination /实际/已有持久挂载/voice-secretary-service \
  --services-stopped
```

工具核对 Linux 挂载表，拒绝 overlay/tmpfs 目标，检查原 Bridge 拥有者和执行中
日志，核验私有副本，保留所有原文件。仅移除副本中的旧 PID 锁，因为 PID
命名空间变化；凭证和请求日志逐字节一致。调用者必须核对 Tailscale 已停止，
工具不能仅凭状态路径证明这一点。将整个核验过的 skill 复制到目标 `skill/`。
保留原 UID/GID 所有权，核对新容器能读写选定的状态/配置挂载。

## 在 Docker 宿主生成并部署

以下持久路径是对应挂载的宿主路径，不能使用容器 overlay 路径。生成私有
覆盖配置，参数必须来自实际检查，不能直接把占位示例当作可运行值：

```bash
python3 scripts/container.py compose \
  --gateway 原服务名 \
  --bridge-image 已核验的带版本OpenClaw镜像 \
  --tailscale-image 已核验的带版本Tailscale镜像 \
  --persistent /实际/宿主持久挂载/voice-secretary-service \
  --openclaw-source /实际/宿主openclaw配置 \
  --home /实际/原用户home --user 原UID:原GID \
  --node /实际/node --openclaw /实际/openclaw \
  --output /私有目录/voice-bridge.compose.json
```

在私有环境用 `docker compose -f 原配置.yml -f /私有目录/voice-bridge.compose.json
config` 合并原配置并核对：原 Gateway 服务/配置保留，仅共享需要的挂载，未
增加端口或 Funnel。获得所有者授权后只启动两个新服务：
`docker compose -f 原配置.yml -f /私有目录/voice-bridge.compose.json up -d
voice-tailscale voice-bridge`。将覆盖配置纳入宿主正常部署流程，让重建仍包含
这些服务。不能另建 Gateway 或随意重启；网络命名空间改变时需协调重建 sidecar。

原 Tailscale 状态必须恢复相同节点及 8443 Serve，不能使用新密钥运行
`tailscale up`。新 sidecar socket 为 `/tmp/tailscaled.sock`。身份或 Serve 未
恢复时应停止并核对副本/版本，不能注册同名新节点冒充恢复。Docker 宿主/守护
进程本身需开机运行；`unless-stopped` 会尊重手动停止。

## 验收与恢复

核对两个容器运行、本机 `/health` 就绪、原节点在线、原域名/8443 Serve 和
带鉴权的原绑定可达。分别手动重启 sidecar 验证恢复，再使用已保存的宿主配置
重建，核对节点身份/请求日志保留。请用户查询原 UUID 并测试明确确认的任务；
不能重放旧任务或自动发测试。部署结果与实际验收分别报告。

需要恢复时先停止两个新 sidecar，再用保留的原代码/状态和原参数启动。旧/新
守护进程不能同时运行。配置生成成功不代表部署成功。

参考：[Docker 多进程](https://docs.docker.com/engine/containers/multi-service_container/)、
[重启策略](https://docs.docker.com/engine/containers/start-containers-automatically/)。
