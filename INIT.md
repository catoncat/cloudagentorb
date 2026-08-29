# INIT — 在当前仓库初始化 Cursor Cloud 编排工作流

你是目标仓库的 setup agent。逐步执行，不要跳步，不要即兴扩展。全程不需要安装任何依赖。

## 1. 复制文件

把本初始化包 `template/` 下的 5 个文件按相同相对路径写入目标仓库根：

```text
AGENTS.md
.cursor/rules/orchestrator.mdc
scripts/extract-orchestrator-context.ts
.scratch/issues/INDEX.md
.scratch/issues/TEMPLATE.md
```

冲突规则：

- 目标仓库已有 `AGENTS.md` → 不要覆盖；把 `template/AGENTS.md` 全文追加到已有文件末尾，用一行 `---` 分隔。
- 其他路径已存在且内容不同 → 保留原文件，把新文件写成同名加 `.orchestration` 后缀，并在最终报告中说明。

## 2. 填占位符

在刚写入的文件里查找并替换以下三个占位符。查不到答案就**问用户**，不要编造：

| 占位符 | 含义 | 怎么定 |
| --- | --- | --- |
| `<YOUR_STRONG_MODEL>` | 云端子代理用的最强模型 slug | 问用户其账号下可用的最强模型 |
| `<YOUR_VERIFY_COMMANDS>` | 本项目的验证命令 | 从 package.json / Makefile / CI 配置推断，再向用户确认（如 `npm test && npm run build`） |
| `<MAX_PARALLEL_TASKS>` | 同时并行的 Cloud Task 数 | 默认 `3`，除非用户另有要求 |

## 3. 自检

1. `bun scripts/extract-orchestrator-context.ts`（无参数）应打印 usage 错误并以非零码退出 —— 证明脚本就位、bun 可用。无 bun 时装 bun 或向用户说明。
2. `grep -rn "<YOUR_\|<MAX_PARALLEL" AGENTS.md .cursor scripts .scratch` 应无输出（占位符已全部替换）。

## 4. 提交

按用户的分支习惯提交（新仓库直接提交当前分支即可）：

```bash
git add AGENTS.md .cursor/rules/orchestrator.mdc scripts/extract-orchestrator-context.ts .scratch/issues/
git commit -m "chore: init Cursor Cloud orchestration workflow"
```

不要强推、不要改动仓库中与本次初始化无关的文件。

## 5. 向用户报告

- 写入 / 追加 / 加后缀的文件清单；
- 三个占位符的最终取值；
- 建议的下一步：在主会话派一个**无害实验 Task**（例如「读取父会话 transcript 并输出 digest 前 10 行」），验证 `cursor-cloud` MCP 与过滤脚本在该账号下可用（流程见 `AGENTS.md` 第 7 节），然后写第一张真实 ticket。
