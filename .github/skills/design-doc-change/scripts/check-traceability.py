#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""docs/ 追溯链与状态自检（MessagePick）

用法:
    python3 .github/skills/design-doc-change/scripts/check-traceability.py
    python3 .github/skills/design-doc-change/scripts/check-traceability.py --strict
    python3 .github/skills/design-doc-change/scripts/check-traceability.py --root /path/to/repo

检查项:
    ERROR  文档不存在 / 状态块缺失 / 状态值非法 / 文档停在 updating
    ERROR  状态块缺少必需字段
    ERROR  CHANGELOG 中 CHG-### 重复或断号
    ERROR  同一文档内同一 ID 在标题行重复定义
    ERROR  design/impl/mod-###-*.md 的文件名与正文声明的模块编号不一致
    ERROR  实现看板（docs/status/implementation.md）缺少必需列
    WARN   AC-### 未引用任何 REQ-###（无法上溯）
    WARN   AC-### 引用了未定义的条目 / 引用了不存在的 REQ-###
    WARN   REQ-### 未被任何 AC-### 覆盖
    WARN   REQ-### 未标注来源 US-###
    WARN   引用了未定义的 ID（MOD-000 除外，它保留给模板）
    WARN   已定义的 MOD-### 未出现在实现看板中
    WARN   看板中的 MOD-### 未在 modules.md 中定义

退出码:
    0  通过
    1  存在 ERROR（--strict 时存在 WARN 也算失败）

规则来源: docs/README.md（§4 DoD、§5 ID、§6 状态机、§7 传播）
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# --------------------------------------------------------------------- 配置区

# 每份文档状态块里必须出现的字段（"> **字段**: 值"）
HEADER_FIELDS: dict[str, list[str]] = {
    "docs/README.md": ["状态", "最后更新"],
    "docs/raw/raw_design.md": ["状态", "来源", "下游", "变更中", "最后更新"],
    "docs/prompt/README.md": ["状态", "上游", "变更中", "最后更新"],
    "docs/product/prd.md": ["状态", "生成者", "上游", "下游", "变更中", "最后更新"],
    "docs/design/README.md": ["状态", "上游", "下游", "变更中", "最后更新"],
    "docs/design/modules.md": ["状态", "生成者", "上游", "下游", "变更中", "最后更新"],
    "docs/design/api-contract.md": ["状态", "生成者", "上游", "下游", "变更中", "最后更新"],
    "docs/design/data-model.md": ["状态", "生成者", "上游", "下游", "变更中", "最后更新"],
    "docs/plan/tasks.md": ["状态", "生成者", "上游", "下游", "变更中", "最后更新"],
    "docs/plan/acceptance-tests.md": ["状态", "生成者", "上游", "下游", "变更中", "最后更新"],
}

# glob 形式：实现层文档数量随模块增长，不逐个列举
HEADER_FIELDS_GLOB: dict[str, list[str]] = {
    "docs/design/impl/*.md": ["状态", "生成者", "上游", "下游", "变更中", "最后更新"],
}

# 实现层目录（用于文件名与引用校验）
IMPL_GLOB = "docs/design/impl/mod-*.md"

VALID_STATUS = {"draft", "reviewed", "updating", "frozen"}

# 每种 ID 由哪份文档定义
OWNERS: dict[str, str] = {
    "US": "docs/product/prd.md",
    "REQ": "docs/product/prd.md",
    "MOD": "docs/design/modules.md",
    "API": "docs/design/api-contract.md",
    "DM": "docs/design/data-model.md",
    "TASK": "docs/plan/tasks.md",
    "AC": "docs/plan/acceptance-tests.md",
    "CHG": "docs/CHANGELOG.md",
}

CHANGELOG = "docs/CHANGELOG.md"
AC_DOC = "docs/plan/acceptance-tests.md"
PRD_DOC = "docs/product/prd.md"

# 参与 ID 定义/引用检查的“数据文档”。
# docs/README.md、docs/prompt/*.md 是说明性文档，其中的 ID 只是举例，不参与检查。
SCANNED_DOCS: list[str] = sorted(set(OWNERS.values()))

# 实现进度看板：不参与状态机，但要与 modules.md 交叉校验
BOARD = "docs/status/implementation.md"
BOARD_COLUMNS = ["模块", "负责人", "实现状态", "设计文档", "最后更新"]

# 保留编号：不参与「引用了未定义 ID」校验
RESERVED_IDS = {"MOD-000"}

PREFIX_GROUP = r"(?:US|REQ|MOD|API|DM|TASK|AC|CHG)"
ID_RE = re.compile(r"\b" + PREFIX_GROUP + r"-\d{3}\b")
HEADING_DEF_RE = re.compile(r"(?m)^#{2,6}\s+(" + PREFIX_GROUP + r"-\d{3})\b")
ROW_DEF_RE = re.compile(r"(?m)^\|\s*(" + PREFIX_GROUP + r"-\d{3})\s*\|")
STATUS_RE = re.compile(r"(?m)^>\s*\*\*状态\*\*:\s*(.+?)\s*$")
FIELD_RE = re.compile(r"(?m)^>\s*\*\*(.+?)\*\*:\s*(.*)$")
HEADING_RE = re.compile(r"^#{2,6}\s")
HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
FENCE_RE = re.compile(r"```.*?```", re.S)

# ------------------------------------------------------------------- 工具函数


def strip_noise(text: str) -> str:
    """去掉 HTML 注释与代码块，避免把示例/图里的 ID 当成真实条目。"""
    return FENCE_RE.sub("", HTML_COMMENT_RE.sub("", text))


def read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    except OSError as exc:  # pragma: no cover
        print(f"读取 {path} 失败: {exc}", file=sys.stderr)
        return None


def find_root(start: Path) -> Path | None:
    for d in [start, *start.parents]:
        if (d / "docs" / "README.md").is_file():
            return d
    return None


def split_sections(text: str) -> list[tuple[str, str]]:
    """按 ## / ### 标题切分为 [(标题行, 正文)]，标题行之前的正文归入 '' 段。"""
    out: list[tuple[str, str]] = []
    title, body = "", []
    for line in text.splitlines():
        if HEADING_RE.match(line):
            out.append((title, "\n".join(body)))
            title, body = line, []
        else:
            body.append(line)
    out.append((title, "\n".join(body)))
    return out


def def_context(text: str) -> dict[str, str]:
    """ID -> 它所在小节的正文（含标题）。用于判断 REQ 是否标注了来源 US。"""
    ctx: dict[str, str] = {}
    for title, body in split_sections(text):
        chunk = title + "\n" + body
        for i in ID_RE.findall(chunk):
            ctx.setdefault(i, chunk)
    body_only = "\n".join(b for _, b in split_sections(text))
    ctx["__doc__"] = body_only
    return ctx


def dedupe(items: list[str]) -> list[str]:
    return list(dict.fromkeys(items))


# ------------------------------------------------------------------------ 主流程


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="docs/ 追溯链与状态自检")
    parser.add_argument("--root", default=None, help="仓库根目录（默认自动向上查找）")
    parser.add_argument("--strict", action="store_true", help="WARN 也视为失败")
    args = parser.parse_args(argv)

    root = Path(args.root).resolve() if args.root else find_root(Path(__file__).resolve())
    if root is None:
        print("找不到仓库根目录（向上查找 docs/README.md 失败），请用 --root 指定", file=sys.stderr)
        return 1

    errors: list[str] = []
    warns: list[str] = []
    infos: list[str] = []
    texts: dict[str, str] = {}

    # ---- 0. 展开 glob，得到全部待检查文档 ----
    targets: dict[str, list[str]] = dict(HEADER_FIELDS)
    for pattern, fields in HEADER_FIELDS_GLOB.items():
        for p in sorted(root.glob(pattern)):
            targets[str(p.relative_to(root)).replace("\\", "/")] = fields
    impl_docs = [
        str(p.relative_to(root)).replace("\\", "/") for p in sorted(root.glob(IMPL_GLOB))
    ]

    # ---- 1. 状态块 ----
    for rel, fields in targets.items():
        raw = read_text(root / rel)
        if raw is None:
            errors.append(f"{rel}: 文件不存在")
            continue
        texts[rel] = raw
        clean = strip_noise(raw)

        m = STATUS_RE.search(clean)
        if not m:
            errors.append(f"{rel}: 缺少状态块（> **状态**: ...）")
        else:
            value = m.group(1).strip().strip("`").split("|")[0].split("或者")[0].strip()
            if value not in VALID_STATUS:
                errors.append(
                    f"{rel}: 状态值非法 '{value}'（合法值：{'/'.join(sorted(VALID_STATUS))}）"
                )
            elif value == "updating":
                errors.append(f"{rel}: 仍停在 updating（变更未收尾，见 SKILL 步骤 6）")

        present = {name.strip() for name, _ in FIELD_RE.findall(clean)}
        for f in fields:
            if f not in present:
                errors.append(f"{rel}: 状态块缺少字段“{f}”")

    # ---- 2. CHANGELOG 编号 ----
    chg_numbers: list[int] = []
    clog = read_text(root / CHANGELOG)
    if clog is None:
        errors.append(f"{CHANGELOG}: 文件不存在")
    else:
        texts[CHANGELOG] = clog
        for line in strip_noise(clog).splitlines():
            if not line.startswith("|"):
                continue
            m = re.match(r"\|\s*[^|]*\|\s*CHG-(\d{3})\s*\|", line)
            if m:
                chg_numbers.append(int(m.group(1)))
        dupes = sorted({n for n in chg_numbers if chg_numbers.count(n) > 1})
        for n in dupes:
            errors.append(f"{CHANGELOG}: CHG-{n:03d} 重复出现 {chg_numbers.count(n)} 次（编号永不复用）")
        if chg_numbers:
            missing = sorted(set(range(1, max(chg_numbers) + 1)) - set(chg_numbers))
            if missing:
                errors.append(
                    f"{CHANGELOG}: 编号不连续，缺 " + "、".join(f"CHG-{n:03d}" for n in missing)
                )
            infos.append(f"CHANGELOG 记录数 {len(set(chg_numbers))}（最大 CHG-{max(chg_numbers):03d}）")

    # ---- 3. ID 定义与重复 ----
    defined: dict[str, set[str]] = {}
    for rel in SCANNED_DOCS:
        raw = texts.get(rel)
        if raw is None:
            continue
        clean = strip_noise(raw)
        headings = HEADING_DEF_RE.findall(clean)
        rows = ROW_DEF_RE.findall(clean)
        owned = {i for i in set(headings) | set(rows) if OWNERS.get(i.split("-")[0]) == rel}
        defined[rel] = owned
        for i in sorted({h for h in headings if headings.count(h) > 1}):
            errors.append(f"{rel}: {i} 在同一文档内重复定义（标题出现 {headings.count(i)} 次）")

    if defined.get(CHANGELOG) is not None:
        defined[CHANGELOG] |= {f"CHG-{n:03d}" for n in chg_numbers}

    all_defined: set[str] = set()
    for ids in defined.values():
        all_defined |= ids

    # ---- 4. 引用完整性 ----
    referenced: dict[str, set[str]] = {}
    for rel in [*SCANNED_DOCS, *impl_docs]:
        raw = texts.get(rel)
        if raw is None:
            continue
        referenced[rel] = set(ID_RE.findall(strip_noise(raw))) - defined.get(rel, set())

    for rel, ids in referenced.items():
        for i in sorted(ids):
            if i not in all_defined and i not in RESERVED_IDS:
                warns.append(f"{rel}: 引用了未定义的 {i}")

    # ---- 5. AC -> REQ -> US 追溯链 ----
    covered: set[str] = set()
    ac_text = texts.get(AC_DOC)
    if ac_text:
        for title, body in split_sections(strip_noise(ac_text)):
            m = re.search(r"\b(AC-\d{3})\b", title)
            if not m:
                continue
            ac = m.group(1)
            reqs = {i for i in ID_RE.findall(title + "\n" + body) if i.startswith("REQ-")}
            if not reqs:
                warns.append(f"{AC_DOC}: {ac} 未引用任何 REQ-###（无法上溯到需求）")
            covered |= reqs

    prd_text = texts.get(PRD_DOC)
    if prd_text:
        prd_clean = strip_noise(prd_text)
        for req in sorted(i for i in defined.get(PRD_DOC, set()) if i.startswith("REQ-")):
            if req not in covered:
                warns.append(f"{PRD_DOC}: {req} 未被任何 AC-### 覆盖")
        ctx = def_context(prd_clean)
        for req in sorted(i for i in defined.get(PRD_DOC, set()) if i.startswith("REQ-")):
            chunk = ctx.get(req, ctx.get("__doc__", ""))
            if not re.search(r"\bUS-\d{3}\b", chunk):
                warns.append(f"{PRD_DOC}: {req} 未标注来源 US-###")

    if AC_DOC in referenced:
        covered |= {i for i in referenced[AC_DOC] if i.startswith("REQ-")}

    # ---- 6. 实现层：文件名与模块编号一致性 ----
    for rel in impl_docs:
        m = re.search(r"/mod-(\d{3})-", rel)
        if not m:
            continue
        want = f"MOD-{m.group(1)}"
        raw = texts.get(rel, "")
        if want not in strip_noise(raw):
            errors.append(f"{rel}: 文件名声明的是 {want}，但文档正文里找不到它（文不对题）")

    # ---- 7. 实现看板与 modules.md 交叉校验 ----
    mods_defined = {i for i in all_defined if i.startswith("MOD-")}
    board = read_text(root / BOARD)
    if board is None:
        warns.append(f"{BOARD}: 文件不存在，无法校验模块分派")
    else:
        clean = strip_noise(board)
        header_cells: set[str] = set()
        for line in clean.splitlines():
            if line.startswith("|") and "---" not in line:
                header_cells = {c.strip() for c in line.strip("|").split("|")}
                break
        missing_cols = [c for c in BOARD_COLUMNS if c not in header_cells]
        if missing_cols:
            errors.append(
                f"{BOARD}: 看板表缺少列 " + "、".join(f"“{c}”" for c in missing_cols)
            )
        board_mods = {i for i in ID_RE.findall(clean) if i.startswith("MOD-")}
        for m in sorted(mods_defined - board_mods):
            warns.append(f"{BOARD}: {m} 已在 modules.md 定义但看板中没有对应行（分派后必须补行）")
        for m in sorted(board_mods - mods_defined - RESERVED_IDS):
            warns.append(f"{BOARD}: {m} 出现在看板中，但 modules.md 未定义")
        infos.append(f"看板覆盖模块数 {len(board_mods)}（已定义模块 {len(mods_defined)}）")

    # ---- 8. 输出 ----
    counts: dict[str, int] = {}
    for i in all_defined:
        key = i.split("-")[0]
        counts[key] = counts.get(key, 0) + 1
    if counts:
        infos.append("已定义条目 " + ", ".join(f"{k}={counts[k]}" for k in sorted(counts)))

    errors, warns = dedupe(errors), dedupe(warns)

    print("== docs/ 追溯链与状态自检 ==")
    print(f"仓库: {root}")
    for level, items in (("ERROR", errors), ("WARN", warns), ("INFO", infos)):
        for item in items:
            print(f"[{level}] {item}")

    failed = bool(errors) or (args.strict and bool(warns))
    verdict = "FAIL" if failed else "PASS"
    print(f"\n结果: {len(errors)} error, {len(warns)} warning → {verdict}"
          + ("（--strict：warning 视为失败）" if args.strict and warns else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
