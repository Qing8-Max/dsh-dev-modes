# 开发模式合集

一个 bundle，三个 Agent 预设，外加配套技能。装一次，三个模式同时出现在「设置 → Agent 预设」。

| 预设 | id | 用途 |
|---|---|---|
| 软件开发 | `swe` | 读仓库与规范 → 规划 → 小步实现 → 用项目自身的构建/测试验证 → 如实汇报 |
| 游戏开发 | `game` | 原型先行、真实运行验证手感与性能；内置 Godot / Unity / Unreal / Cocos 工作流 |
| 只读讨论 | `discuss` | 能读代码与文档、看图、搜索、提问；不能写文件、跑命令、启动程序 |

## 自带技能

`skills/` 下六个技能由本插件的 `index.js` 在启动时注册进技能目录（`source: bundled`），无需再手动复制到 `~/.dsh/skills`：

- `software-delivery`：软件交付流程清单
- `game-dev-delivery`：游戏交付流程（引擎无关）
- `game-godot`、`game-unity`、`game-unreal`、`game-cocos`：各引擎工作流

如果 `~/.dsh/skills/` 里还留着同名副本，运行时会优先使用本包注册的版本；可以删掉副本以免困惑。

## 安装

```text
plugin_manager → install_bundle → target = 本目录绝对路径
```

或：插件页 → Add plugin → 选择本目录。

安装后验证：`Config.listConfigs`（`@deepseek-ai/dsh-agent-preset`）应出现 `include:preset-swe`、`include:preset-game`、`include:preset-discuss`；`list_plugins` 三行均为 `active`。

已有会话保留原模式，需要**新建会话**才会使用新模式。

## 从文件安装 / 分发

本包不依赖仓库里的任何东西：`index.js` 用 `import.meta.url` 定位自带技能，其余都是静态文件。因此可直接：

- 打包：`pnpm pack`（生成 `dsh-dev-modes-1.0.0.tgz`）
- 分发：把 tarball 或整个目录给另一台机器，用 Add plugin / `install_bundle` 安装
- 发布到插件市场：把包发布到 npm（或推到公开 Git 仓库），再托管一份市场索引 JSON；索引格式见 `dist/market-index.example.json` 与 PUBLISH.md

## 修改

- 预设内容在 `cordis.patch.yml`（三个 `- insert:` 块），改完 `remove_bundle` + `install_bundle` 重装。
- 技能内容在 `skills/`，改完重装或重启生效。
- 图标/文案：`icon.svg`、`locale/*.json`、本 README。
