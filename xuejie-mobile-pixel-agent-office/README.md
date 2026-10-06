# 学姐通信 · XUEJIE MOBILE Pixel Agent Office

Phase 1 已验收；Phase 2 实现真实 Manager → Translator → Manager 链路。只有总控和翻译 Agent 执行任务，其他四个 Agent 保持 IDLE。不包含游戏系统。未进入 Phase 3。

## 运行

Node.js 24+（使用 Node 内置 SQLite）。

```sh
npm ci --cache /tmp/xuejie-npm-cache
npm run build
npm test
```

两个终端分别运行：

```sh
npm run server
npm run dev -- --port 5173 --strictPort
```

后端绑定 127.0.0.1:3001；Vite 将 `/api` 请求代理给后端。后端同时提供 `dist` 中的生产页面，因此生产检查不需要额外的 4173 预览服务。开发环境的 `?visualTest=1` 是独立 Phase 1 测试模式，不挂载 Runtime 连接；正式任务页面没有手动状态面板。

## OpenAI 配置

仅在服务端环境配置：

| 名称 | 默认 / 用途 |
| --- | --- |
| `LLM_PROVIDER` | `openai-responses` |
| `LLM_BASE_URL` | `https://api.openai.com/v1` |
| `LLM_MODEL` | 用户指定的 `gpt-6-luna` |
| `LLM_API_KEY` | 必填 Secret，目标 `api.openai.com` |
| `LLM_MAX_TOKENS` | 4096，每次 Responses 请求的最大输出 token 数 |
| `LLM_TIMEOUT_MS` | 60000，每次调用的整体超时，含一次可重试响应 |
| `TASK_DB_PATH` | `.local/tasks.sqlite` |
| `API_PORT` | 3001；修改时需同步 Vite 代理目标 |
| `APP_ORIGIN` | `http://localhost:5173` |

环境设置安全注入 `LLM_API_KEY`；不要在聊天中发送密钥。也可在本机使用被 Git 忽略的 `.env`；`.env.example` 不含密钥。不要使用 `VITE_` 前缀。后端使用环境 HTTPS 代理，不提取代理中的认证信息。配置改变后重启后端。只在密钥存在时启用 Provider，缺少配置时拒绝提交真实任务，不使用替代结果。

使用 OpenAI **Responses API**：`POST /v1/responses`，服务端 Bearer 认证，`store:false`，按 `output[].content[].output_text` 提取输出。总控规划用 JSON 输出。Provider 接口独立于 Runtime；未实现其他服务商 Adapter。

默认输入上限 12000 字符、单次输出上限 4096 token、最多 10 个等待任务。一次成功链路需要三次模型调用：规划、翻译、汇总。每次调用最多对 429/5xx 重试一次；认证失败不重试。以上是调用限制，并非金额预算保证。

`gpt-6-luna` 的实际 API 可用性及权限必须通过真实请求确认；测试适配器不证明模型存在或账号有权限。真实调用尚待用户注入 Secret 后完成。

## 执行与事件

1. 用户提交真实原文及目标语言。
2. Manager 调用真实模型，识别翻译或请求澄清；本阶段不执行计算、搜索等需求。
3. Translator 调用真实模型，保留金额、币种、日期、套餐名称及限制条件，单独标注歧义。
4. Manager 调用真实模型汇总。原译文独立保存，用户可以展开核对。
5. 任务结果保存后返回 UI。失败明确返回错误，部分译文保留但不标记任务完成。

TaskQueue 串行执行，避免多个任务争用同一个 Agent。任务状态为 queued/running/needs_input/completed/failed。补充信息需重新提交完整原文和目标语言，并关联原任务 ID。

服务端状态变化产生持久化事件（任务 ID、Agent ID、状态、全局递增序号、时间）。SSE `/api/events` 连接及重连发送最新快照，随后推送实时事件。前端只把这些事件交给 Phase 1 的总线。requestAnimationFrame 仍只负责原有角色移动；没有计时器模拟任务结果。SSE 心跳仅保活连接。

状态顺序：Manager THINKING → WAITING → WORKING → DONE → IDLE；Translator WORKING → DONE → IDLE。WORKING 表示真实模型调用期间。真实调用失败发布 ERROR。需要补充信息时 Manager WAITING。完成后由 Runtime 发布 IDLE，不由动画切换状态。

SQLite 保存任务、译文、结果和事件；不记录 API Key。后端重启将进行中的任务标记为失败，不自动重复未确认的调用；尚未开始的 queued 任务在有 Provider 时继续执行。

## 项目结构

```text
server/types.ts          Agent / Task / Tool / LLMProvider 契约
server/provider.ts       OpenAI Responses Adapter、超时与有限重试
server/runtime.ts        Registry、Manager、Translator、Router、Queue、Executor、EventBus、Runtime
server/store.ts          SQLite 任务与事件存储
server/app.ts            HTTP、SSE、生产静态页面
server/index.ts          后端启动
src/task/RuntimeBridge.tsx  SSE 桥、输入、进度与结果
src/runtime/model.ts     原 Phase 1 Agent 与 UI 总线（未修改）
src/office/              原办公室、移动、碰撞与寻路（未修改）
public/sprites/          原母版与裁切图集（未修改）
```

## 验证

`npm test` 检查链路顺序、澄清、失败、排队、重启、HTTP、Responses 协议、重试及原有寻路；同时校验可见角色像素 RGB 与母版一致。

启动后端与 Vite 后，`npx playwright test --workers=1` 检查原有视觉移动、生产面板隔离、缺密钥拒绝执行、HTTP/SSE → Office 状态同步、结果与重载恢复。测试中的 Provider 是明确注入的测试替身，生产入口不支持模拟 Provider。测试与真实 OpenAI 验收必须区分。

真实验收：配置 Secret、重启后端，提交例如 `把以下政策翻译成中文：월 이용료 33,000원. 약정 24개월. 중도 해지 시 위약금이 발생합니다.`，核对金额、合约期和违约金条件，并确认任务 completed、译文及汇总可见、状态来源为 runtime。失败时检查错误；不得用测试结果替代真实验收。

Phase 2 不实现 Multi-Agent 编排、Web/文件/Excel Tools 或定时任务。Tool 接口仅预留，没有挂载实际工具。完成真实链路验收后停止，等待用户决定下一阶段。
