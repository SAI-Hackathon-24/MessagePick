# 模型服务配置（LLM）

> **状态**: —（工作备忘，不参与 `docs/README.md` §6 的状态机）
> **适用范围**: 本机服务进程调用的模型服务；三项（地址 / 凭据 / 模型名）都可改，不写死在代码里。

---

## 1. 已写好的默认配置

仓库里已经生成好 `data/config.json`（该目录被 `.gitignore` 忽略，**不会进版本库**），
默认指向 DeepSeek 官方端点，**只差填 API Key**：

```json
{
  "model": {
    "baseUrl": "https://api.deepseek.com/v1",
    "apiKey": "",
    "name": "deepseek-chat",
    "taskConcurrency": 4
  }
}
```

三项的含义：

| 字段 | 含义 | 换供应商时怎么改 |
| --- | --- | --- |
| `model.baseUrl` | OpenAI 兼容端点；代码会请求 `POST {baseUrl}/chat/completions` | 换成对方的地址，例如 `https://api.moonshot.cn/v1` |
| `model.apiKey` | Bearer 凭据。**只写不读回**：`GET /api/settings` 只返回 `apiKeyConfigured` 布尔 | 换成对方的 Key |
| `model.name` | 模型名（不带供应商前缀） | 换成对方的模型名，例如 `kimi-k2-0711-preview` |
| `model.taskConcurrency` | 模型任务并发上限（1–64） | 按额度调整 |

任何 **OpenAI 兼容**的服务都能直接用，不需要改代码。

## 2. 填 Key（两种方式，任选）

### 方式 A：命令行（推荐，密钥不进命令历史）

```bash
cd <仓库根>
./scripts/set-model-key.sh          # 交互输入，不回显
# 或
DEEPSEEK_API_KEY=sk-xxxx ./scripts/set-model-key.sh
```

该脚本只改 `model.apiKey`，用「临时文件 + rename」原子替换，并把文件权限设为 `0600`。

### 方式 B：页面「设置」对话框

启动服务后用启动日志里那条带令牌的地址打开页面 → 右上角「设置」→ 填「模型服务地址 / 凭据 / 模型名」→ 保存。
写操作走 `PUT /api/settings`，需要启动令牌（无令牌时只读、写入口置灰）。

> ⚠️ 开发期用 `npm run dev:web`（vite）访问时，**写操作会被 Origin 守卫拒绝（403）**：
> 服务端只接受与本机服务同源的 Origin。设置与其它写操作请走 `npm start` 托管的页面。

## 3. 换其它供应商 / 自建网关

改 `data/config.json` 的 `model` 三项即可；或重新生成一份（会打印到终端，自行重定向覆盖）：

```bash
npx tsx scripts/gen-config.ts                                  # 用默认值（DeepSeek）
MESSAGEPICK_MODEL_BASE_URL=https://api.example.com/v1 \
MESSAGEPICK_MODEL_NAME=your-model \
npx tsx scripts/gen-config.ts > data/config.json
chmod 600 data/config.json
```

`scripts/gen-config.ts` 的字段模板直接取自后端 `DEFAULT_CONFIG`，所以代码新增配置项时
重新生成就能跟上，不会出现「文档写了、代码不认」的漂移。

## 4. 改完要重启服务

配置在**进程启动时**读取一次（`shell.config` 日志行会打印 `taskConcurrency` 等）。
改完 `data/config.json` 后重启：

```bash
# Ctrl+C 停掉旧进程
MESSAGEPICK_NO_OPEN=1 npx tsx src/server/main.ts
```

启动日志里的 `pageUrl` 是权威地址（端口默认 `0` = 每次自动选空闲端口；
想让端口固定便于开发期代理，把 `server.port` 设成具体值，如 `8787`）。

## 5. 验证配置是否生效

```bash
curl -sS http://127.0.0.1:<端口>/api/settings | python3 -m json.tool
```

期望看到：

```json
{ "model": { "baseUrl": "https://api.deepseek.com/v1",
             "apiKeyConfigured": true,          ← 填了 Key 才是 true
             "name": "deepseek-chat",
             "taskConcurrency": 4 } }
```

`apiKeyConfigured` 为 `false` 时说明 Key 没读到（检查是否重启、文件权限、JSON 是否合法；
若 JSON 坏了，启动时会把坏文件备份成 `config.json.bad` 并以默认值启动）。

## 6. 修过的一个相关缺陷（供排查参考）

**`model.name` 此前无处可配**：`EngineConfig.model.name` 是模型调用的必需项
（空值直接抛「未配置模型名」），但 `ShellConfig` / `config.json` / `SettingsPatch`
里**都没有这个字段**，`applyEngineConfig()` 也没把它交给引擎 —— 引擎侧永远是空串，
每一次模型调用在入口即失败，且界面上没有任何地方能改。
已在提交 `e893729` 补齐六个落点（类型 / 默认值 / 解析 / 视图 / 补丁 / 引擎传参）。

若仍报「未配置模型名」，检查 `data/config.json` 是否有 `model.name`（老配置里不会有，
补上或重新生成）。
