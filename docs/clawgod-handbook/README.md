# ClawGod Handbook

面向 Claude Code 安全研究工作流的上下文治理参考文档。

---

## 这是什么

方法论文档 + 可直接运行的 hook 脚本，帮助安全研究员在 Claude Code 中建立**可控的研究环境**。

包含：

- 方法论文档（MD）— 理解设计思想
- 可运行脚本（Python）— 复制并注册到配置后使用，无需自己写代码
- 一键安装器 — `bash setup.sh` 或 `.\setup.ps1`

### 解决什么问题

安全研究工作流可能受到两个层面的限制：

1. **模型层**：模型可能因缺少研究背景或自身策略而拒绝请求
2. **客户端层**：客户端的权限与工具策略可能在工具调用前拦截操作

ClawGod 修改部分客户端行为；Session Rules 补充研究背景；Guard 按配置规则检查工具调用。这些配置不能保证模型接受请求或所有客户端限制都被解除。

### 不是什么

- 不是安全研究教程
- 不是漏洞利用指南
- 不是对任何产品的攻击
- 不是绕过工具或攻击框架

---

## 快速开始

### 最小配置

以下命令从本仓库根目录执行。

1. 按本仓库的 [安装说明](../../README_ZH.md) 安装 ClawGod
2. 复制 `docs/clawgod-handbook/01-session-rules/security-research-context.md` 到 `~/.claude/rules/`
3. 重启 Claude Code 或 `clawgod`，在新会话中加载规则

```bash
# macOS / Linux：复制规则文件
mkdir -p ~/.claude/rules
cp docs/clawgod-handbook/01-session-rules/security-research-context.md ~/.claude/rules/
```

### 场景配置

根据你的工作场景，额外加载对应的 rules 模板（下表路径相对于 `docs/clawgod-handbook/`）：

| 场景 | Rules 文件 | 复制到 |
|------|-----------|--------|
| CTF 竞赛 | `01-session-rules/examples/ctf-research.md` | `~/.claude/rules/` |
| 漏洞分析 | `01-session-rules/examples/vuln-analysis.md` | `~/.claude/rules/` |
| 应急响应 | `01-session-rules/examples/incident-response.md` | `~/.claude/rules/` |

不需要所有都放，只放你当前场景需要的。

### 一键安装 Hook 脚本（场景识别 + 工具守卫）

```bash
# macOS / Linux
cd docs/clawgod-handbook/hooks
bash setup.sh
```

```powershell
# Windows (PowerShell)
cd docs\clawgod-handbook\hooks
.\setup.ps1
```

需先安装 Python 3。安装脚本会复制并注册 Hook，重启 Claude Code 后加载：

- **Scene Router**：根据工作目录和关键词自动识别安全研究场景
- **Tool Guard**：按 `BLOCK_RULES` 检查 Bash 命令和 Write 路径，包括破坏性命令、系统路径写入、特定凭据工具和扫描命令
- **审计日志**：场景识别与工具守卫的决策记录在 `~/.claude/audit/`

卸载 Hook 时，在上述 `hooks` 目录运行 `bash uninstall.sh`（macOS/Linux）或 `.\uninstall.ps1`（Windows）。独立卸载脚本移除 Hook 脚本及注册项，保留 rules 和审计日志。详见 [Hook 安装与卸载说明](hooks/README.md)。

---

## 文档结构

```
docs/clawgod-handbook/
├── README.md                              ← 你在这里
├── hooks/                                 ← 可直接运行的脚本
│   ├── scene-router.py                   # 场景识别 hook（需注册）
│   ├── tool-guard.py                     # 工具守卫 hook（需注册）
│   ├── setup.sh                          # 一键安装（macOS/Linux）
│   ├── setup.ps1                         # 一键安装（Windows）
│   ├── uninstall.sh                      # 独立卸载（macOS/Linux）
│   ├── uninstall.ps1                     # 独立卸载（Windows）
│   └── README.md                         # 安装说明
├── 01-session-rules/                      ← Layer 1：模型层
│   ├── security-research-context.md       # 核心身份模板（必读）
│   ├── rules-reference.md                # Rules 机制解释
│   └── examples/                         # 场景 rules 模板
│       ├── ctf-research.md
│       ├── vuln-analysis.md
│       └── incident-response.md
├── 02-scene-router/                       ← Layer 2：场景识别方法论
│   ├── methodology.md                    # 三级降级设计思想
│   ├── hook-implementation.md            # Hook 实现参考
│   └── keyword-tables/                   # 关键词和否定词表
│       ├── sec-research-keywords.md
│       └── negation-filter.md
├── 03-guard-policy/                       ← Layer 3：工具守卫方法论
│   ├── pretooluse-guide.md               # Guard 实现指南
│   ├── policy-levels.md                  # 四级策略定义
│   └── examples/                         # Guard 示例
│       ├── bash-guard.md
│       ├── write-guard.md
│       └── policy-config-snippet.md
├── 04-scenarios/                          ← 端到端场景案例
│   ├── ctf-full-walkthrough.md           # CTF：从安装到解题
│   ├── vuln-research-walkthrough.md      # 漏洞研究
│   ├── code-audit-walkthrough.md         # 代码审计
│   └── ir-walkthrough.md                 # 应急响应
└── appendix/
    ├── audit-log-schema.md               # 审计日志格式
    ├── clawgod-integration.md            # 与 ClawGod 配合说明
    └── compatibility.md                  # 非 Claude Code 适配
```

---

## 四层架构概览

```
用户输入
    ↓
Layer 0: ClawGod Runtime Patch    ← 修改部分客户端行为
    ↓
Layer 1: Session Rules            ← 给模型补齐"你是谁"
    ↓
Layer 2: Scene Router             ← 判断"当前在干什么"
    ↓
Claude 模型推理
    ↓
Layer 3: PreToolUse Guard         ← 决定"工具该不该执行"
    ↓
工具执行 / 策略引擎 / 审计日志
```

各层分别承担客户端补丁、研究上下文、场景识别和工具检查职责；Guard 的检查范围由脚本中的规则决定。

---

## 设计哲学

1. **该注入时注入，不该注入时沉默** — 好的治理框架首先要知道什么时候不该介入
2. **脚本化安装** — 安装器完成 Hook 复制和注册，不需要手写代码
3. **按需配置** — 从核心 Rules 文件开始，再按场景增加规则和 Hook
4. **Hook 决策可审计** — 通过场景识别与工具守卫日志检查决策过程
5. **通用方法论** — 四层架构的思想可以适配其他 AI Code 产品

---

## 许可证

MIT — 自由使用、修改和分发。

与 ClawGod 项目独立，不要求安装 ClawGod 即可使用本文档。

---

## 免责声明

本文档仅供安全研究和教育目的。使用者应确保其行为符合当地法律法规和相关服务条款。作者不对任何滥用行为承担责任。
