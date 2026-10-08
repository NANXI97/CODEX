# 学姐通信 · XUEJIE MOBILE Pixel Agent Office

真实 AI Agent 可视化工作台，不是游戏。Phase 1–3 已验收；Phase 4 已有文件、CSV/XLSX、公开网页读取与搜索。为用户指定 Kakao 政策聊天的只读处理补齐图片和 PDF 的真实识别工具。个人 Kakao 客户端尚未连接，等待用户提供实际资料或完成电脑端接入。

办公室、六个角色、Sprite 母版、移动、碰撞、寻路和原状态模型保持原样。Pixel Office 只消费后端真实状态，不决定任务执行。

## 运行

Node.js 24+；React、TypeScript、Vite、Canvas、Express、Node 内置 SQLite。工具依赖：read-excel-file、csv-parse、fflate、cheerio、image-size。

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

后端绑定 127.0.0.1:3001，提供生产 `dist` 页面；Vite 的 `/api` 代理指向后端。重复启动在端口占用时明确失败，不改变正在运行的后端任务记录。已有服务正常时直接复用；代码更新后只重启已确认属于本项目且空闲的后端。

开发环境 `?visualTest=1` 可独立测试原办公室；生产任务页面没有手动状态面板。用户现已选择电脑和手机都可用的浏览器网址，`web-access` 分支准备了受登录保护的正式部署入口，操作见 [DEPLOYMENT.md](DEPLOYMENT.md)。当前尚无已验证的公网网址。

正式运行：`npm run build` 后 `npm start`，需 Node 24、`NODE_ENV=production`、安全环境变量 `APP_PASSWORD`、HTTPS `APP_ORIGIN`（Render 自动提供来源地址），以及持久化任务/上传/会话路径。后端和页面在同一服务提供；生产默认监听 `0.0.0.0`，优先使用托管提供的 `PORT`。不要将开发模式直接暴露公网。

## 用户操作

1. 在“交给 AI 团队……”输入任务。
2. 需要资料时点击“添加资料”，上传 TXT、MD、CSV、XLSX、PDF、PNG、JPEG 或静态 WEBP。
3. 需要查询公开网页时勾选“允许联网查询”。默认关闭；网页搜索产生额外 API 费用。
4. 提交后看实际步骤、Agent 状态、结果；展开“实际工具调用”可核对参数、数据范围、文件 SHA-256、URL 和时间。

例如：“实际读取附件韩文政策并翻译成中文”；“用附加月度表的收入和成本计算总利润，金额均为含税韩元，不换币”；“读取这个公开网页并核对来源”。

只有本次任务附加的文件可被工具读取。需要补充信息时点“补充并继续”，新任务继承原任务附件，并结合原输入重新规划；联网权限按提交时勾选值执行。移除待提交附件只取消关联，不删除已上传的本地文件或历史记录。

## Kakao 政策资料：当前接入边界

用户选择读取一个指定政策聊天，翻译、整理并分析文字、政策截图和 Excel/PDF 附件，不发送消息。本批补齐资料读取能力；没有登录用户 Kakao、读取个人聊天历史、监控新消息或自动下载聊天附件。

[Kakao 官方 Message API](https://developers.kakao.com/docs/latest/en/kakaotalk-message/common) 提供发送到自己或同一服务好友的能力，没有个人客户端群聊记录读取接口。当前 Linux 云环境不能操作用户 Windows Kakao 客户端，也未安装本地连接器。导出文件导入属于用户提供资料，不是实时群聊接入。不要将截图、验收样例或文件名当成已经读过该群的证据。

目前可先导出指定聊天的文字 TXT，另行保存需要分析的政策图片或附件，并附加到任务。不要默认导入整个账号。任务可写：“这是从指定 Kakao 政策群导出的资料，请实际读取、翻译成中文、整理适用对象、价格、税费、期限和限制；保留原文日期、来源文件和模糊事项。没有提供成本时不要猜利润。” 导出 TXT 目前须为 UTF-8；群名、发送者和日期只在原文提供时使用，文件的上传时间不是政策生效时间。聊天文本中的图片占位文字不等于已读取图片，相关图片必须分别附加。当前最多四个附件，较多资料需分批处理。

自动读取新消息还需要验证电脑端能否只读取得指定群的内容，并建立连接器到后端的安全通信；本批没有实现或验证这一步。当前云开发后端绑定 loopback，正式部署配置可提供公网浏览器服务，但尚未部署到外部托管。后续接入方式需结合实际资料与用户选择，不能用未验证的 Windows UI 自动化或聊天数据库解析假装已连接。

## 模型配置

仅在后端环境设置以下变量，不能使用 `VITE_` 前缀或提交真实 `.env`。

| 名称 | 默认 / 用途 |
| --- | --- |
| `LLM_PROVIDER` | `openai-responses` |
| `LLM_BASE_URL` | `https://api.openai.com/v1` |
| `LLM_MODEL` | `gpt-6-luna`；全部 Agent 与网页搜索统一使用 |
| `LLM_API_KEY` | 必填，通过环境安全设置注入 |
| `LLM_MAX_TOKENS` | 4096，每次请求最大输出 tokens |
| `LLM_TIMEOUT_MS` | 60000；无效格式或范围回退此默认值，不打印原值 |
| `TASK_DB_PATH` | `.local/tasks.sqlite` |
| `UPLOAD_DIR` | `.local/uploads`，本地持久化附件 |
| `API_PORT` | 3001；改变时同步 Vite 代理 |
| `APP_ORIGIN` | `http://localhost:5173` |

当前云环境使用 Environment variables 注入 `LLM_API_KEY`，不要添加同名 Network secret。不得向聊天发送 Key；后端日志、前端、Git 和保存的设置说明均不包含真实 Key。保留平台 HTTPS 代理、CA 和 TLS 校验。

OpenAI Adapter 使用服务端 Bearer、`POST /v1/responses`、`store:false`；规划和专业输出使用 JSON Schema，后端另行严格验证。Adapter 将 Responses 不支持的 Schema 写法转换为支持的形式，不移除本地 Zod 校验。

Runtime 只依赖通用 `LLMProvider`；网页搜索为可选 `searchWeb` 能力，图片/PDF 识别为可选 `readDocument` 能力。当前 OpenAI 实现通过原生 `web_search` 真正搜索，要求 completed 搜索事件与可核对 URL 引用，不把普通回答当搜索。识别通过 Responses 的实际图片或 PDF 输入执行，统一使用 `gpt-6-luna`，无需新增 API Key。其他 Provider 没有对应能力时，不能声称支持，也不提供伪造工具。

最多对 429/5xx 重试一次，认证失败不重试；缺配置拒绝执行，不存在生产 mock。网页搜索、模型请求均按服务商实际用量计费；任务步骤上限与 token 上限不是金额预算保证。空闲办公室和动画不触发模型调用。

## 六个固定 Agent 与工具

| Agent | 角色与实际执行 |
| --- | --- |
| Manager / 黑柴 | 理解、澄清、依赖拆分、分配、汇总；不凭附件文件名编造内容 |
| Customer / 马尔济斯 | 基于事实写客服回复草稿，不发送消息 |
| Design / 黄柴 | 文本与朋友圈文案，不生成图片 |
| Translator / 灰白猫 | 忠实翻译，保留金额、币种、期限和限制 |
| Data / 橘猫 | 读取表格、后端聚合、来源校验和真实算术 |
| Policy / 三花猫 | 整理资料；获准联网后核对实际公开来源 |

专业 Agent 挂载只读文件/网页工具；表格聚合工具仅挂载 Data。工具只有在任务已附加文件或明确启用联网时才提供给模型。所有模型结果是真实调用；算术和文件解析由后端实际执行，不执行模型生成的 JS、Shell 或任意文件路径。

| 后端工具 | 返回内容 |
| --- | --- |
| `file.read` | TXT/MD 片段、字符范围、是否还有后续内容、文件指纹 |
| `document.read` | 图片/PDF 的模型识别原文、完整/部分范围、无法辨认事项、来源指纹及读取时间 |
| `spreadsheet.inspect` | 工作表名称、行列数及前五行预览；预览不等于全表分析 |
| `spreadsheet.read` | 明确的工作表/行列范围及真实单元格，单次最多 500 格 |
| `spreadsheet.aggregate` | 指定范围的 sum/average/min/max/count、空值数、实际结果 |
| `web.read` | 实际 HTTPS 页面正文、最终 URL、标题、抓取时间及截断标记 |
| `web.search` | 真实搜索回答、来源链接和查询时间 |

工具协议：模型请求结构化 `toolCall` → 后端校验工具和权限 → 执行 → 真实结果供模型继续处理。每步最多六次工具调用；达到上限则失败或请求补充，不能制造成功。工具调用 `running/completed/failed` 保存到 TaskStep，并随 SSE 同步，重载仍可查看。请求失败阻断后续步骤；没有成功读取附件时不能将任务标记完成。

## 文件与网页边界

- 文件单个 ≤5 MB，每个任务最多四个。本地上传区上限 100 MB／100 文件；文件用随机 ID 保存，原名仅作显示，不用作路径。
- TXT/MD/CSV 为 UTF-8；CSV 使用逗号分隔、一致列数。支持 BOM、引号与字段中的换行。
- PNG/JPEG/静态 WEBP 检查格式和尺寸，最大边长 8192 像素、最多 1600 万像素，不修改或重新生成图片。PDF 检查文件容器，拒绝加密文件；实际内容由模型 API 读取，不执行其中的代码、宏或指令。长 PDF 建议按相关政策页拆分。
- 图片/PDF 识别使用真实 Responses API 的内联资料输入（`store:false`），每次识别产生 API 费用。转录最多 12000 字符，返回 coverage、uncertain 和 notes；部分、裁切或模糊内容不得声称全文已读，无法读取则失败。模型识别并非精确 OCR：来源指纹保证文件一致，不能保证每个识别数字正确；模糊金额不用于计算，需要清晰资料核对。
- XLSX 支持最多八个工作表，10000 行、100 列、50000 格；解压总大小 ≤20 MB。保留十进制字面值，不转浮点后再计算。公式工作簿目前拒绝接收，请转为数值或导出 CSV。不执行宏、外部链接或公式。
- 表格行列从 1 开始，含表头。聚合时明确范围、排除表头；空值忽略，其他非数字报错。sum/average/min/max 使用 BigInt 有理数，最多六位小数半入舍入；百分数字面值按比例处理。count 统计非空格。
- 文件和表格输出超过上限会失败；文本和网页片段含明确截断标记，不应宣称读过全部内容。工具读取并不意味着已验证全部业务口径。
- 网页读取仅公开 HTTPS、443；不附带 LLM Authorization，也不带网站登录凭据。校验 URL、DNS 公网地址和每次重定向，拒绝私有/保留地址；继承平台代理，由平台控制最终出站。最多三次重定向、15 秒、2 MB；正文最多 10000 字符。JavaScript 页面、登录页面或反爬限制可能无法读取，不绕过网站访问控制。
- 网页及附件属于资料，不是角色/工具权限指令。默认不联网；搜索只用于任务相关的公开信息，提示 Agent 不将附件中的私人或内部经营内容作为搜索词。此提示不等于自动隐私脱敏。

## 依赖、计算与状态

Manager 最多拆八步，拒绝重复/保留标识、不存在的依赖、自身或循环依赖。TaskQueue 串行处理用户任务，同一任务最多两个已就绪步骤并行，同一 Agent 同时只执行一步。只有全部依赖完成后才启动下游，并提供直接依赖的实际结果。

Data 输出有界计算表达式，由后端执行加减乘除。操作数必须逐字来自用户、已完成直接依赖或真实工具结果 `tool_N`。拒绝编造数字、截取数字、除零、重复计算标签、过深表达式和执行代码。工具聚合结果可作为计算来源。

确定性算术保证所选数字及运算；字段意义、币种、期间和业务口径仍需模型与用户核对。缺必要口径则询问，不猜利润；不把验收样例当真实门店数据，也不在公开文案中泄露内部成本/利润。

步骤 `pending/waiting/running/completed/failed/blocked/needs_input`。一处失败停止新调度，等待真实进行中的请求结束，保留已完成输出，阻断未执行步骤。全部步骤完成后总控才汇总。

Agent 状态来源于 Runtime：规划 THINKING；等待依赖/补充 WAITING；真实模型/工具/算术执行 WORKING；完成 DONE；错误 ERROR；释放 IDLE。动画不能决定业务状态，没有伪造 Working 的计时器。

SQLite 保存任务、步骤、计算、工具结果与事件，兼容旧任务；上传文件另存在忽略的 `.local/uploads`。SSE 每次连接发送权威快照。后端重启将中断任务/工具标记失败，保留已完成输出，不自动重放中断请求；未开始的 queued 任务在配置可用时正常启动。

## 项目结构

```text
server/types.ts             Agent / Task / Tool / File / Provider 契约
server/agents.ts            总控与五个专业 Agent，结构化计划和结果
server/tools.ts             工具挂载、权限校验与有限工具对话
server/files.ts             持久化附件、CSV/XLSX 解析及范围聚合
server/documents.ts         图片/PDF 校验与识别结果契约
server/web.ts               公开网页访问与正文抽取
server/calculation.ts       数字来源校验与确定性算术
server/provider.ts          OpenAI Responses / Schema / 原生搜索与资料识别 Adapter
server/runtime.ts           队列、依赖调度、状态和工具记录
server/store.ts             SQLite 任务及事件
server/app.ts              HTTP、上传、SSE 和生产静态页面
server/index.ts            绑定端口后初始化后端，防止重复启动污染状态
src/task/RuntimeBridge.tsx  统一输入、SSE 与任务记录
src/task/Attachments.tsx    附件和联网选项、实际调用与来源展示
src/task/Workflow.tsx       实际执行步骤
src/runtime/model.ts       原 Agent 状态模型（未改）
src/office/                原办公室、移动、寻路与碰撞（未改）
public/sprites/            原 Sprite 母版与图集（未改）
```

## 验证

`npm test`：39 项检查，覆盖此前的依赖、并行、算术、HTTP/SSE、导航，以及文件真实解析、附件权限/指纹、XLSX 限制、表格精确聚合、工具循环/失败/中断、Schema 适配、网页 URL/DNS/重定向、搜索协议、重复启动不污染状态。新增资料格式/尺寸/加密检查、真实字节到多模态 HTTP 的协议、识别范围/附件权限、未读取图片不能冒充完成。Sprite 校验确认 239113 个可见像素 RGB 与母版一致。

`npx --cache /tmp/xuejie-npm-cache playwright test --workers=1`：九项浏览器检查，包含原办公室移动、开发面板隔离、任务状态与重载、补充关联，CSV 上传/实际后端聚合/工具记录和来源链接，以及图片上传/识别记录/部分覆盖/重载。需先启动 Vite，办公室测试会实际访问开发服务。模型和外部响应的替身只在自动化测试中注入；真实验收另行实际调用 OpenAI API。

真实验收记录位于被 Git 忽略的 `.local/phase4-real-*.json`，包含实际任务与 Runtime 事件，不含 API Key。实际结果与时间以这些记录为准。

尚未实现：Kakao 客户端自动读取/本地连接器/新消息监听、旧 XLS、工作簿公式求值/写回、Google Drive、Gmail、Excel 导出、图片生成、通信政策知识库、门店数据库、定时任务，以及外部托管的实际发布和旧数据迁移。公开部署配置、登录入口与桌面/手机验证已准备好，见 DEPLOYMENT.md；准备好不等于已经上线。未将其伪装为完成，也未提供 placeholder 工具返回。

**本批工具完成后停止，等待验收；不自行追加集成或外部发送功能。**

2026-10-08 真实 OpenAI Responses API／gpt-6-luna 验收已完成：

| 任务 | 实际后端工具 | 核验结果 |
| --- | --- | --- |
| TXT 韩文政策翻译 | file.read | completed；33,000 韩元含税、24 个月、提前解约违约金及新客户限制保留，约 14 秒 |
| XLSX 验收样例 | inspect、read、两次 aggregate | completed；实际 A1:C3，收入 77,000、成本 52,000、利润 25,000 韩元，约 34 秒 |
| CSV 小数验收样例 | inspect、aggregate | completed；实际 A2:A3，0.1+0.2 合计精确 0.3 元，约 19 秒 |
| 网页读取及搜索 | web.read、web.search | completed；实际读取 example.com，真实搜索返回 OpenAI 官方文档 URL 引用，约 49 秒 |

上述金额是验收文件中的样例，不代表门店经营数据。每条任务的实际工具调用、计算与 Runtime 事件均已保存；未使用 mock。执行过程中发现的结构化格式兼容问题已修复；失败记录保留，没有改写成成功。当前实例全部六个 Agent 已释放为 IDLE。

2026-10-08 新增资料识别真实验收（OpenAI Responses API／gpt-6-luna）：

| 资料 | 实际流程 | 核验结果 |
| --- | --- | --- |
| 标注“验收样例”的韩文 PNG | Manager → Translator（document.read）→ Policy → Data → Manager | completed；只识别一次，保留含税月费 33,000、成本 22,000、24 个月、外国人新客户和解约违约金；后端算得样例月利润 11,000 KRW，约 43 秒 |
| 同一验收样例的单页 PDF | Manager → Translator（document.read）→ Policy → Manager | completed；实际 PDF 输入，保留原文和页码、税费及限制，复核译为增值税；约 36 秒 |

两份资料是为验收生成的样例，不来自用户 Kakao 群；不能据此宣称 Kakao 接入成功。任务与 Runtime 事件存于忽略的 `.local/kakao-documents-acceptance/real-*.json`，核验摘要为 `checks.json`。首轮发现 Policy 越过当前步骤去请求计算工具，任务真实停为 needs_input；已收紧步骤执行范围并复用上游资料，重新调用通过。复核还发现韩文 부가세 误称为“附加税”，已明确“增值税（VAT）”术语并重新真实调用通过，不补充原文缺失税率。原失败/补充记录保留，未改写成成功。生产运行没有 mock。
