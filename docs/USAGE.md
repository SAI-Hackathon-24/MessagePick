# 使用文档

> 面向**使用者**：从零把 MessagePick 跑起来、采到自己的群聊、看到三个模块的结果。
> 面向开发者的设计文档在 `docs/design/`；模型与配置项的细节见 `docs/NOTES-model-config.md`。

---

## 1. 它是什么

单机、单用户的本地 Web 应用：**采集本机微信聊天记录**，在浏览器里看三件事——

| 模块 | 解决的问题 |
| --- | --- |
| **群聊梗分析** | 这群人在玩什么梗、谁带火的、火过多久、有没有凉 |
| **群聊信息提取** | 通知 / 待办 / DDL / 投票 / @所有人 这类「要办的事」 |
| **正向 / 反向社交** | 我喜欢什么（人→兴趣）；想找搭子该找谁（兴趣→人） |

**数据不出本机**：服务只监听回环地址，模型请求是你自己配的端点，没有账号体系、没有对外入口。

## 2. 环境要求

- **Node ≥ 22.12**（`node -v` 确认）
- **微信数据可在本机读取**（依赖 `wechat-cli`，见 §4）
- 一个 **OpenAI 兼容**的模型服务端点 + 凭据（DeepSeek / Kimi / 自建网关都行）
- Linux / macOS；Windows 未验证

## 3. 安装

```bash
git clone git@github.com:SAI-Hackathon-24/MessagePick.git
cd MessagePick

# 后端依赖
npm install

# 前端依赖（独立包，不在主工程内）
npm --prefix webui install
```

## 4. 采集通道：wechat-cli

MessagePick 不直接解密微信数据库，而是调用 [`wechat-cli`](https://github.com/SAI-Hackathon-24/wechat-cli) 读取记录。

```bash
# 1) 安装（示例：装在独立 venv 里）
python3 -m venv ~/.venvs/wechat-cli
~/.venvs/wechat-cli/bin/pip install -e /path/to/wechat-cli

# 2) 首次初始化：需要提权提取数据库密钥（只需做一次）
#    把 --db-dir 换成你自己的微信数据目录
sudo env WECHAT_CLI_CONFIG="$HOME/.wechat-cli/config.json" \
  ~/.venvs/wechat-cli/bin/wechat-cli init \
  --db-dir "$HOME/文档/xwechat_files/<你的wxid>/db_storage"

# 3) 验证
~/.local/bin/wechat-cli sessions | head
```

> ⚠️ **Linux 上的自动探测可能失败**：CLI 会去找 `~/Documents/xwechat_files/*/db_storage`，
> 而中文系统里通常是 `~/文档/xwechat_files/...`。这时按上面的写法**显式传 `--db-dir`** 即可。
>
> ⚠️ 初始化会生成 `~/.wechat-cli/all_keys.json`（**属主可能是 root**）。服务进程要能读到它；
> 若报「未初始化或未授权」，检查该文件与所在目录的读权限。

## 5. 配置（模型 + CLI 路径）

```bash
# 生成配置模板（默认指向 DeepSeek，字段取自后端默认值，不会与代码漂移）
npx tsx scripts/gen-config.ts > data/config.json
chmod 600 data/config.json

# 填模型凭据（交互输入、不回显、原子替换）
./scripts/set-model-key.sh
```

`data/config.json` 的关键项：

```json
{
  "model": {
    "baseUrl": "https://api.deepseek.com/v1",
    "apiKey": "sk-...",
    "name": "deepseek-chat",
    "taskConcurrency": 4
  },
  "cli": {
    "executable": "/home/<你>/.local/bin/wechat-cli",
    "stateDir": ""
  },
  "server": { "port": 8787 },
  "ingest": {
    "pageSize": 1000,
    "autoTriggerAfterIngest": true,
    "analysisGroupIds": []
  }
}
```

| 项 | 说明 |
| --- | --- |
| `model.*` | 任何 OpenAI 兼容端点；换供应商只改这三项，**不用改代码** |
| `cli.executable` | `wechat-cli` 的**绝对路径**（服务进程的 PATH 里可能没有） |
| `cli.stateDir` | **留空**。填了会额外注入 `WECHAT_CLI_CACHE=<stateDir>/cache`，若该目录不可写会直接失败 |
| `server.port` | 固定端口便于反复访问；`0` = 每次自动选空闲端口 |
| `analysisGroupIds` | **待分析群**；留空 = 只入库、不分析（见 §7） |

## 6. 构建与启动

```bash
npm run build     # 构建 webui/ → webui/dist，并做服务端类型检查
npm start         # 启动服务（启动日志会打印带令牌的页面地址）
```

打开日志里那条 **带 `#token=...` 的地址**：

```
MessagePick 服务已启动（仅本机可访问）：http://127.0.0.1:8787/
页面地址（含启动令牌，请用此地址打开）：http://127.0.0.1:8787/#token=<32位>
```

- **必须用带令牌的地址**：读操作不需要令牌，但**写操作**（更新数据、分析、改判、设置）需要；没有令牌时界面呈只读。
- 令牌只存在页面内存里、刷新即失效；每次重启服务都会换新。
- 想开发前端：`npm --prefix webui run dev`（默认 5273，`/api` 代理到 8787）。
  ⚠️ **代理下写操作会被 Origin 守卫拒绝（403）**，完整功能请走上面的托管地址。

## 7. 第一次使用（推荐顺序）

### ① 先看总览

打开页面先落在「总览」，它会显示 `记录更新至 X`。**此时还没有数据，属正常**。

### ② 采集：只入库

右上角「**更新数据**」→ 选来源（群消息 / 通讯录）→ 开始。

采集只做一件事：**把消息写进本地库**。它**不会**自动分析任何群——这是刻意的：

> 分析要为每个群逐人调用模型。实测 22 个群、8428 条消息时，仅「兴趣抽取」一步
> 就需要约 1000 次调用、耗时以十分钟计。默认全量开跑会让「点一下更新」
> 变成长时间无响应的黑盒。

### ③ 选待分析群：设置 → 待分析群

设置面板最上方是「**待分析群**」：

- 群列表**按最近活跃排序**，并显示消息数与最近消息时间——据此判断该看哪个群；
- 点「**选最近活跃的 2 个**」快速默认（列表前几个就是最活跃的）；
- 「清空选择」= 不分析任何群（只保留入库的数据）。

### ④ 触发分析

两种方式，效果相同：

| 方式 | 说明 |
| --- | --- |
| 设置 → 待分析群 → **立即分析这 N 个群** | 数据已采过时用这个，**不必再采一次** |
| 直接再点一次「更新数据」 | 采集完成后按 `analysisGroupIds` 自动分析 |

分析在**后台**跑，接口立即返回。进度看 `GET /api/operations`（界面上是操作状态）。
日志里会有可读的进度：

```
warmup.scope {"groups":2}
social.build.stage3.progress {"done":100,"total":4035}
```

### ⑤ 看结果

| 想去哪 | 左侧导航 |
| --- | --- |
| 梗词云 / 梗生命周期 / 梗列表 / 梗王榜 / 梗年鉴 | 群聊梗分析 |
| 消息时间轴 / 通知总览 / 待办与 DDL | 群聊信息提取 |
| 人物兴趣画像 / 按兴趣找人 / 两人配对 / 我的契合度 / 人-人图谱 / 身份对齐 | 正向 / 反向社交 |

## 8. 社交模块为什么「要等一会儿」

社交画像需要一份**内存索引**，它在构建的**第 8 阶段**才生成，而构建是逐人调用模型
（真实数据 4000+ 人，约十几分钟）。完成前相关接口返回 `IDENTITY_NOT_READY`。

界面会显示「**社交画像正在构建，请稍候**」——**这是正常的中间态，不是报错**。
可以先去别的模块看，稍后回来即是结果。

## 9. 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 打开页面提示只读、写按钮置灰 | 没用带 `#token=` 的地址；从启动日志里重新复制 |
| 写操作 403 | 同「只读」；开发代理（5273）下写操作必被 Origin 守卫拒绝，请用托管地址 |
| 采集报「找不到 wechat-cli 可执行文件」 | `cli.executable` 没配成绝对路径 |
| 采集报「未初始化或未授权」 | `~/.wechat-cli/all_keys.json` 读不到（权限）；或 `cli.stateDir` 非空导致缓存目录不可写 |
| 模型调用报「未配置模型名 / 服务地址」 | `data/config.json` 的 `model.name` / `model.baseUrl` 为空；改完**需重启服务**（配置只在启动时读一次） |
| 改完配置不生效 | 同上：**必须重启**。`GET /api/settings` 可核对 `apiKeyConfigured` |
| 梗词云只有十几个 | 身份视角被切到「我」；切回「**身份：全局**」（实测全局 209 个 vs 我相关 19 个） |
| 生命周期图几乎是空的 | 数据时间跨度太短：梗首现都集中在最近几天。采更长历史后才有月度分布 |
| 页面写着「更新了但什么都没有」 | 分析没跑：`analysisGroupIds` 为空时**只入库不分析**（见 §7③④） |

## 10. 数据与隐私

| 项 | 位置 |
| --- | --- |
| 应用数据目录（库、配置、日志） | `data/`（被 `.gitignore` 忽略） |
| 数据库 | `data/app.db` |
| 配置（含模型凭据） | `data/config.json`（权限 `0600`） |
| 日志 | `data/logs/` |
| wechat-cli 状态与密钥 | `~/.wechat-cli/`（**不要提交**） |

- 模型调用会把**消息样本**发给你配置的端点；不配置模型则分析不可用（采集与浏览仍可用）。
- 删除入口在设置面板底部：可按群删除或全量清空（含原始记录与派生结果，需二次确认）。

## 11. 常用命令

```bash
npm run typecheck          # 服务端类型检查
npm test                   # 服务端测试（vitest）
npm run build              # 构建前端 + 服务端类型检查
npm start                  # 启动服务

# 契约探针：不需要浏览器，直接验证前后端信封与字段形状
node webui/scripts/contract-probe.mjs http://127.0.0.1:8787

# 重新生成配置模板
npx tsx scripts/gen-config.ts > data/config.json
./scripts/set-model-key.sh
```
