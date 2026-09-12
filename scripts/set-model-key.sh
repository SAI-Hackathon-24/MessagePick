#!/usr/bin/env bash
# 设置模型凭据（不改动其它配置项）。
#
# 用法：
#   ./scripts/set-model-key.sh                 # 交互输入（不回显）
#   DEEPSEEK_API_KEY=sk-xxx ./scripts/set-model-key.sh
#
# 说明：直接改 data/config.json 的 model.apiKey。该文件权限 0600、且被 .gitignore 忽略
# （密钥不会进版本库）。服务进程启动时读取配置，改完需重启服务。
# 也可以启动服务后用页面「设置」对话框提交（走 PUT /api/settings，需要启动令牌）。
set -euo pipefail

cd "$(dirname "$0")/.."
CONFIG="data/config.json"

if [[ ! -f "$CONFIG" ]]; then
  echo "找不到 $CONFIG —— 先生成：npx tsx scripts/gen-config.ts > $CONFIG" >&2
  exit 1
fi

KEY="${DEEPSEEK_API_KEY:-}"
if [[ -z "$KEY" ]]; then
  read -r -s -p "请粘贴 API Key（输入不回显）：" KEY
  echo
fi
if [[ -z "$KEY" ]]; then
  echo "未输入内容，已取消。" >&2
  exit 1
fi

python3 - "$CONFIG" "$KEY" <<'PY'
import json, sys, os, tempfile
path, key = sys.argv[1], sys.argv[2]
with open(path, encoding='utf-8') as f:
    cfg = json.load(f)
cfg.setdefault('model', {})['apiKey'] = key
# 临时文件 + rename：原子替换，避免写一半损坏配置
d = os.path.dirname(os.path.abspath(path))
fd, tmp = tempfile.mkstemp(dir=d)
with os.fdopen(fd, 'w', encoding='utf-8') as f:
    json.dump(cfg, f, ensure_ascii=False, indent=2)
    f.write('\n')
os.chmod(tmp, 0o600)
os.replace(tmp, path)
print('已写入 model.apiKey（长度 %d），文件权限 0600。' % len(key))
PY
