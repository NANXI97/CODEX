# 电脑和手机打开工作室

当前已准备好可部署版本；没有创建 Render 服务，没有实际公网工作室网址。云环境的“保存并发布”保存开发环境，不会创建用户网站。

## 你只需完成的网站设置

1. [打开 Render 部署设置](https://render.com/deploy?repo=https://github.com/NANXI97/CODEX/tree/web-access)，注册或登录自己的 Render 账号。
2. 按网页要求连接 GitHub 仓库 `NANXI97/CODEX`，确认使用 `web-access` 分支。配置来自根目录 `render.yaml`；不要选择只有初始 README 的 `main`。
3. 在 Render 提示的安全输入框填写下面两个值。不要发到聊天或截图，也不要填到前端变量中。

| Render 字段 | 你填写什么 |
| --- | --- |
| `APP_PASSWORD` | 自己设置的工作室登录密码，16–256 字符，没有前后空格和换行。可以用密码管理器生成；这是登录工作室用的，不是 OpenAI 密钥。 |
| `LLM_API_KEY` | 你自己的 OpenAI API Key。现有 Codex 云环境的 Secret 不会自动转移到 Render。 |

4. 在 Render 显示费用的页面确认服务并部署。构建完成且服务标记为 Live 后，网页提供实际的 `https://…onrender.com` 地址。
5. 用电脑或手机打开这个实际地址，输入工作室登录密码，就能看到原办公室。输入真实任务、附加资料后，后台执行并实时显示状态。

如遇页面不同或部署报错，可提供不含密码和 Key 的页面截图/错误文字。服务网址可以发给 Codex 核验外网访问；登录密码不要发到聊天。

## 费用

本配置是一个付费 Node Web Service（Starter）加 1 GB 持久磁盘。截至 2026-10-08 查询 [Render 官方价格](https://render.com/pricing)，基本服务约 **7 美元/月**，磁盘 **0.25 美元/GB/月**，合计基础约 **7.25 美元/月**；税、额外带宽等以你的结算页面为准。OpenAI 模型和搜索的用量另计，空闲办公室不触发模型调用。

[Render 的持久磁盘只支持付费服务](https://render.com/docs/disks)。本项目保存 SQLite 任务和原始附件，不能将它当作仅发布静态页面的网站。不要去掉磁盘换成临时文件系统，否则重启/重新部署会丢失新记录和附件。此文档没有代表用户购买服务。

## 部署实际行为

- 同一个 HTTPS 地址提供 React 页面、API、文件上传和 SSE 状态同步，不需要分别配置前后端域名。默认来源自动采用 Render 提供的 `RENDER_EXTERNAL_URL`。自定义域名时设置 `APP_ORIGIN=https://你的域名`，不包含路径。
- Node 24.19.0；构建为 `dist/` 页面与 `dist-server/index.js` 后端，`npm start` 运行正式后端，不需要 Vite 或 tsx。托管提供 `PORT`，生产监听 `0.0.0.0`。
- 正式环境没有 `APP_PASSWORD` 或有效 HTTPS 来源时拒绝启动。`/healthz` 只返回基本存活状态；任务历史、详细健康信息、上传、任务执行和 SSE 必须登录。
- 登录使用 HttpOnly、Secure、SameSite=Strict Cookie，8 小时有效；SQLite 保存随机会话 token 的哈希。失败登录最多同 IP 五次/15 分钟。退出立即撤销会话及对应 SSE；修改密码使旧会话失效。
- `/var/data/tasks.sqlite` 保存任务，`/var/data/uploads` 保存附件，`/var/data/access.sqlite` 保存登录会话。使用一个服务实例；SQLite 和当前队列不支持横向多副本。
- 自动部署关闭。更新代码后在 Render 手动部署，并在没有执行中任务时操作。持久磁盘部署会短暂中断服务；真正被中断的任务仍按原 Runtime 标为失败，保留已经完成的输出，不伪造完成或自动重新收费执行。
- 首次外部部署创建新的数据目录。**现有 Codex 云环境的任务和上传文件不会自动迁移。** 如需保留旧记录，须在服务空闲时安全迁移 SQLite 及上传目录到该服务的持久磁盘；不能提交到公共 GitHub 仓库或放进前端包。当前没有执行这项外部数据迁移。
- 这是单人/共享密码的私人工作室，没有新增多用户、邀请、用户权限体系或 Kakao 自动读取。原办公室、Sprite、毛色、移动、寻路、碰撞、状态模型与业务执行逻辑保持原样。

## 本次核验

- 46 项后端、权限、工具、导航检查通过；Sprite 校验确认 239113 个可见像素 RGB 与母版一致。
- 11 项浏览器检查通过，包括 1280px 电脑和 390px 手机的登录、原办公室、任务记录、重载、退出，以及此前任务/SSE/附件工具检查。
- 正式包另在隔离目录仅安装生产依赖验证：无需 tsx 正常启动；未设置登录密码先拒绝启动；匿名不能读取任务；登录后实际上传和 SSE 正常；重启后任务、上传与会话仍在；退出后旧 Cookie 失效。
- `render.yaml` 通过 Render 官方 JSON Schema 校验。
- 本批验证未发起新的付费模型请求，没有为公开部署伪造实际公网网址。自动化的模型替身仅用于已有测试，不进入正式运行包。真正的外部部署、外网 HTTPS 和托管端模型调用仍待账号配置后验证。

技术依据：[Blueprint](https://render.com/docs/blueprint-spec)、[分支部署按钮](https://render.com/docs/deploy-to-render)、[服务默认环境变量](https://render.com/docs/environment-variables)、[Node 版本](https://render.com/docs/node-version)。
