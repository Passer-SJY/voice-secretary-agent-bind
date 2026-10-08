<p align="right"><a href="planning.md">English</a> · <strong>简体中文</strong></p>

# 手机规划快照与修改提案

新增 `voice-secretary-planning/v1`，兼容原会话绑定、凭证、Serve 地址和任务派发。
通过既有受监督容器服务升级已审核 Skill 源码，保留持久状态；不要重新注册绑定、
重置 Tailscale 或启动第二个 Bridge。旧 App 不分享这些数据，旧 Bridge 返回 404，
App 保留本机数据并提示需要升级。

## 只读取用户选择的手机数据

用户在 App 设置中启用规划分享，为一个带认证会话绑定选择日历和提醒清单。手机发送
有界分页快照，Bridge 收齐所有页后原子发布。不包含录音、声纹向量或无关存储。
提醒镜像可带 `appTaskID`、`appKind` 和 `agentState`；勾选提醒与业务 Agent 执行结果
是两种状态。

在已绑定 OpenClaw 容器内，沿用受监督 Bridge 的 `VS_BIND_STATE`：

```bash
node scripts/bridge.mjs planning-read BINDING_UUID 0 100
```

返回 `calendarSyncedAt`、`remindersSyncedAt`、`receivedAt`、版本、所选容器、`total`
和 `nextOffset`，按下一偏移继续分页。手机可能离线或后台挂起，来源同步时间可能缺失
或过期，回复时说明快照时间，不宣称实时连接。空范围表示分享已撤销，不能替换为其他
本地日历或别的绑定数据。本地 CLI 需私有状态目录权限；HTTP 沿用绑定 bearer 凭证，
不使用公开 Funnel。

## 提交需审核的修改

将一项结构化操作写入 JSON 文件。日期用带明确偏移的 ISO 8601；日程须有非空标题、
起止时间和时区。提醒的仅日期截止省略 hour/minute。目标必须是已知、已分享且可写的
容器。修改/完成/删除使用快照中的原始 `itemID` 与 `expectedRevision`；此接口不支持
重复范围修改，需明确交给 Apple App。每个操作用独立 UUID。

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "kind": "reminder",
  "operation": "complete",
  "itemID": "reminder:ITEM_IDENTIFIER_FROM_SNAPSHOT",
  "expectedRevision": "REVISION_FROM_SNAPSHOT",
  "containerID": "SELECTED_LIST_IDENTIFIER",
  "change": { "completed": true }
}
```

```bash
node scripts/bridge.mjs planning-propose BINDING_UUID PROPOSAL.json
```

新增用 `operation: create`，不填写 itemID/expectedRevision。支持 schedule/reminder；
操作为 create、edit、complete（仅提醒）、delete。change 可用 title、notes、start、
end、allDay、timeZoneID、location、clearLocation、due、clearDue、completed；due 含
year/month/day 与可选 hour/minute/timeZoneID。空 notes 字符串清除备注。不虚构版本、
目标、重复范围或手机权限。相同 UUID/正文重交返回同一待处理/终态操作，换正文会拒绝。

提交只是排队提案，不修改手机或执行 Agent 任务。App 活跃时读取提案，显示修改前后，
等待用户确认，并再次检查权限、范围和版本。新增先持久保存意图，再写 EventKit，并用
操作 URL 接回丢失回执，避免重复创建。已应用/拒绝/冲突回执持久保存，可在断网后重传。
中断的 applying 操作需手机核对，不能因为暂无结果就换新 UUID 重新创建。用相同文件
再执行 planning-propose 可查看回执；只有状态 applied 才能宣称成功。

## 部署与验收

只升级通用、已审核 Skill 包，保留既有 Docker 持久卷、绑定文件、节点身份与监督进程。
读取/提交提案本身不需要业务执行或飞书消息。部署前运行 Node 测试；测试/构建不代表
用户远程容器已升级。所有者授权发布/部署后，沿用原绑定验证限定读取、过期状态、提案
审核、手机写入和回执。撤销的空范围更新送达 Bridge 后停止新快照分享；已经进入 Agent
会话的数据不能通过本协议追溯遗忘。

## 项目快照扩展（本地候选版）

`voice-secretary-planning/v1` 的增量项目扩展包含明确选中的 `projectIDs`、
`projects` 目录（稳定 ID、名称、说明、版本）以及可选的
`shareEveryday`/`shareUnclassified` 开关。这些开关默认关闭；选择日历或提醒清单
不会授予全部项目访问权。分享项目背景和选中 App 事项概况，不包含录音、声纹模板
或无关事项证据。

`kind: app-item` 携带 `appTaskID`、`appKind`、`appRevision`、`projectPlacement`、
`projectName` 和确定性版本。它们为只读（`writable: false`），Bridge 必须拒绝创建/
完成/修改这类事项。仅用作规划上下文；Agent 派发仍需单独审核请求。所选日历/提醒
事项仅在对应项目明确分享时携带项目归属。既有日历/提醒提案和手机确认语义不变。

旧 Bridge 仍可处理仅含普通日历/提醒事项的快照，但可能拒绝项目事项快照；App
报告不兼容并保留本地数据。获得发布/部署授权后，通过既有持久 Docker 服务升级
通用候选版，不重新绑定。本地打包/测试不证明远端已升级。验收需在真实手机/容器
检查选定范围、快照时间、项目事项只读、提案回执、重启和分享撤销。
