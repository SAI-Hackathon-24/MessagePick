# 设计变更回流（已迁移为 Skill）

> **状态**: —（指针文件，不参与文档状态机）
> **类型**: 指针 / 重定向
> **定义位置**: `.github/skills/design-doc-change/SKILL.md`
> **自检脚本**: `.github/skills/design-doc-change/scripts/check-traceability.py`
> **最后更新**: 2026-09-12

流程定义已**整体迁移**为工作区 skill，不在本文件内维护。迁移原因与「prompt vs skill」的分工见 `docs/README.md` §11。

## 为什么保留这个文件

- `.github/skills/` 不是 `docs/` 的一部分，从 `docs/prompt/` 的索引看会凭空少掉「回流」这一环。留指针，流水线在文档上是完整的。
- 把 `docs/` 架构复制到别的项目时，能顺着这个指针知道 skill 应该建在哪、叫什么名字。
- 旧的链接和引用不会失效。

## 用法

```bash
# 手动（斜杠命令）
/design-doc-change 变更请求：改什么（条目 ID）/ 为什么 / 期望结果

# 或直接描述变更，skill 会被自动加载
把 PRD 里 REQ-014 的口径改成按会话计数

# 收尾自检
python3 .github/skills/design-doc-change/scripts/check-traceability.py
```

## 不要在这里写流程细节

写在这里会与 `SKILL.md` 形成第二份事实来源，违反 `docs/README.md` §1 的 SSOT 原则。要改流程，改 `SKILL.md`。