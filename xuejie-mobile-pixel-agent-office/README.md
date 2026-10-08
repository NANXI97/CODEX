# 学姐通信 · XUEJIE MOBILE Pixel Agent Office

真实 AI Agent 可视化工作台，不是游戏。Phase 1 与 Phase 2 已验收；当前实现 Phase 3 多 Agent 编排，完成后等待验收，不进入 Phase 4。

办公室、六个角色、Sprite 母版、移动、碰撞和寻路保持原样。Pixel Office 只消费后端状态，不能决定任务执行或制造 Working。

## 运行

Node.js 24+，React、TypeScript、Vite、Canvas、Express、Node 内置 SQLite。没有新增运行依赖。

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

后端绑定 127.0.0.1:3001，同时提供生产 `dist` 页面。Vite 的 `/api` 代理指向后端。开发环境 `?visualTest=1` 独立测试原办公室；正式任务页面没有手动状态面板。

## 模型配置与安全

只通过后端环境设置配置以下变量，不能使用 `VITE_` 前缀或提交真实 `.env`。

| 名称 | 默认 / 用途 |
| --- | --- |
| `LLM_PROVIDER` | `openai-responses` |
| `LLM_BASE_URL` | `https://api.openai.com/v1` |
| `LLM_MODEL` | `gpt-6-luna` |
| `LLM_API_KEY` | 必填，完整 OpenAI API Key；不进入前端、日志或 Git |
| `LLM_MAX_TOKENS` | 4096，每次请求的最大输出 token 数 |
| `LLM_TIMEOUT_MS` | 60000，毫秒；格式或范围错误时使用安全默认值并输出不含原值的提示 |
| `TASK_DB_PATH` | `.local/tasks.sqlite` |
| `API_PORT` | 3001；改变时需要同步 Vite 代理 |
| `APP_ORIGIN` | `http://localhost:5173` |

目前云环境使用 **Environment variables** 注入 `LLM_API_KEY`，不要再次添加同名 Network secret。仅在安全环境设置中输入值，不发送到聊天。本机可使用被 Git 忽略的 `.env`。后端保留平台 HTTPS 代理及 TLS 验证。

`OpenAIResponsesProvider` 使用 `POST /v1/responses`、服务端 Bearer、`store:false`，解析真实 output text。Runtime 只依赖 `LLMProvider` 契约。缺密钥拒绝执行，没有模拟 Provider 或随机结果。调用最多对 429/5xx 重试一次，认证失败不重试；每个工作阶段独立超时。

API 按实际模型用量计费。任务步骤、全局等待队列和 token 上限不是金额预算保证；单纯渲染办公室不发起 LLM 调用。

## 六个固定 Agent

| Agent | Phase 3 执行范围 |
| --- | --- |
| Manager / 黑柴 | 分析、澄清、拆分依赖、分配、汇总 |
| Customer Service / 马尔济斯 | 基于已提供事实撰写客服回复草稿，不发送消息 |
| Design / 黄柴 | 撰写文本、朋友圈文案，不生成图片 |
| Translator / 灰白猫 | 忠实翻译，保留金额、币种、期限和限制 |
| Data / 橘猫 | 分析已有数据；算术由后端核对来源并执行 |
| Policy / 三花猫 | 整理已提供政策、资料，不查询或编造最新政策 |

所有执行都经过真实 LLM；数据计算另外经过后端确定性校验。未参与当前任务的 Agent 不会为了展示而工作。工具契约保留，本阶段没有挂载 Web、文件、Excel、邮件、图片生成、知识库、门店数据库或定时工具。

## 依赖与调度

Manager 返回结构化计划：`action=execute/clarify/unsupported`、`steps`、`question`、`scopeNote`。每步包含唯一 `id`、专业 `agentId`、`instruction`、`dependsOn`。最多八步，拒绝重复标识、不存在的依赖、自身依赖和循环依赖。

TaskQueue 串行处理用户任务；同一任务内最多同时执行 **两个已就绪的独立步骤**，同一 Agent 同时只执行一步。步骤只有在全部依赖 `completed` 后才会启动，并只收到那些直接依赖的实际结果。

例如：Translator → Policy → Data → Design。客服回复可依赖 Policy，在 Data 工作时独立执行。缺成本时先询问，不编造利润；外部工具需求明确说明尚不支持。

工作步骤状态：`pending/waiting/running/completed/failed/blocked/needs_input`。某步失败会停止新调度，等待真实进行中的请求结束，然后将未执行步骤标记为 blocked，保留已完成的结果。全部步骤完成后 Manager 才汇总。汇总失败时也不会伪装任务成功。

Agent 状态只来自 Runtime：规划 THINKING；等待依赖、调度或补充信息 WAITING；执行真实请求/计算 WORKING；结果完成 DONE；执行错误 ERROR；释放后 IDLE。没有动画定时器决定业务状态。

## 数据计算

Data 模型输出有界算术表达式，后端执行加、减、乘、除。每个业务操作数必须逐字引用用户输入或已完成直接依赖的数字；不能截取其他数字的一部分，也不能引用未提供的成本。

采用 BigInt 有理数计算，避免浮点货币误差；显示最多六位小数，按半入规则舍入。百分数字面值自动转换为比例。只允许常量 1 和 100 用于比例换算；可引用前面已计算的项目。拒绝除零、无法核对的来源、重复项目和过深表达式。

表达式不是代码，不使用 eval，不执行模型生成的脚本，也不调用外部计算服务。模型仍负责理解字段、币种、期间和计算口径；确定性计算只保证所选操作数及运算，不替代对业务含义的核对。计算式、精确结果和专业输出均保存并可展开查看。

## 输入、结果与持久化

用户仍只有一个输入框。前端额外展示简洁的步骤列表、依赖、真实状态及实际结果，不修改办公室布局。需要补充信息时点击“补充并继续”，提交新任务并关联原任务；总控结合原请求和补充信息重新规划执行，不自动重复处于中断状态的任务。

SQLite 保存任务、步骤、结果、计算式和递增状态事件。已有 Phase 2 记录仍可查看。SSE 连接/重连发送最新权威快照，随后推送实时 task/agent 事件。心跳只保活。

后端重启将进行中的任务标记失败：已完成步骤保留，running 步骤标记失败，未执行步骤 blocked。尚未开始的 queued 任务在配置可用时正常启动；不会把中断请求当作已完成，也不自动重放它。

输入上限 12000 字符；关联补充后的上下文最多 24000 字符；最多十个等待用户任务。未经用户明确要求，不在对外文案中公开内部成本和利润。

## 项目结构

```text
server/types.ts            Agent / Task / Step / Tool / LLMProvider 契约
server/agents.ts           六个真实 Agent 与计划依赖校验
server/calculation.ts      数字来源校验与确定性算术
server/runtime.ts          队列、依赖调度、失败处理和 Runtime 事件
server/provider.ts         OpenAI Responses Adapter、超时与有限重试
server/store.ts            SQLite 任务、步骤和事件
server/app.ts              HTTP、SSE、生产静态页面
server/index.ts            后端启动
src/task/RuntimeBridge.tsx SSE 桥、统一输入与结果
src/task/Workflow.tsx      Runtime 步骤展示
src/runtime/model.ts      原 Agent 状态与 UI 总线（未改）
src/office/               原办公室、移动、碰撞与寻路（未改）
public/sprites/           原母版与图集（未改）
```

## 验证与真实验收

`npm test`：20 项单元/集成检查，覆盖依赖、有限并行、单 Agent 互斥、失败阻断、澄清关联、真实算术、重启恢复、HTTP、Responses 协议及原有寻路。Sprite 校验确认 239113 个可见像素保留母版 RGB。

启动后端与 Vite 后运行 `npx playwright test --workers=1`：六项浏览器检查，覆盖办公室移动、开发面板隔离、缺配置拒绝工作、HTTP/SSE 状态与步骤、结果及重载、补充信息关联。测试 Provider 只在测试文件中注入，与真实 API 验收严格区分。

2026-10-08 已完成真实 OpenAI Responses API 验收：

- Phase 2：Manager → Translator → Manager，真实翻译完成。
- Phase 3：缺成本的利润请求返回 needs_input。
- Phase 3：同一请求完成翻译、政策整理、利润计算、朋友圈文案和客服回复草稿，任务 completed。33,000−22,000 得到 11,000 韩元/客户/月。客服在政策完成后与数据步骤并行，文案等待数据完成，最后总控汇总。
- 所有参与角色的状态来自 Runtime；实际计划的依赖时间与最多两个同时执行的限制均已核对。验收记录保存在被 Git 忽略的 `.local/phase3-real-*.json`，不包含 API Key。

**Phase 3 到此停止，等待用户验收。Phase 4 的工具扩展尚未实现。**
