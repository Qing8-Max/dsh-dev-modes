---
name: game-godot
description: Godot 4 引擎工作流：项目结构、headless 验证、运行中检查、导出前置条件与实例归属；项目含 project.godot / *.tscn / *.gd 时加载。
whenToUse: 项目有 project.godot 或 .tscn/.gd 文件，需要跑场景、改节点与脚本、做逻辑测试或导出时。
---

# Godot 4 工作流

## 识别与结构

- 项目文件：`project.godot`（输入映射、自动加载、渲染设置）、`.tscn` 场景、`.gd` 脚本、`.tres` 资源、`export_presets.cfg`。
- 版本：`godot --version` 或读 `project.godot` 的 `config/features`；Godot 3 与 4 的 API/插件不通用，别照搬。
- 节点路径、`@export` 参数、`Autoload` 单例、信号连接保持既有约定；改之前先读同场景的其他脚本。

## 运行与验证（一律走 godot_* 工具）

- 语法预检：`godot_validate_script`；静态场景/资源操作用 `godot_headless_op`。
- 交互运行：`godot_run_project`；无头逻辑/场景测试：`godot_run_headless`（带 `--quit-after N`，或脚本里 `get_tree().quit()`）。
- 运行中检查：`godot_command` 读场景树、UI 元素、截图、改属性、模拟输入；性能用 `get_performance`。
- 运行日志：`godot_get_debug_output`；脚本报错先看返回值里的 `errors`。
- 禁止用 shell（pwsh/bash）直接启动 Godot：沙箱会拦 `user://` 写入，导致 signal 11 崩溃。

## 实例归属

- `godot_run_project` 可能接管用户已打开的实例并返回 `external:true`：此时**不要杀进程**。让用户在编辑器按 F8，或对子进程运行用 `godot_command` 的 `eval get_tree().quit()`。
- `eval` 只在非 debug 实例可用；需要多帧调用栈时才用 `debug:true`。

## 静默运行（开关开启时）

系统提示里有「静默运行」段落时，窗口不许挡用户。启动 GUI 后**立刻**执行，别只说不做：

- Godot 内部（首选，无闪烁）：
  `godot_command eval "DisplayServer.window_set_position(Vector2i(20000, 20000))"`
- 系统层面（也适用于编辑器、浏览器预览）：
  `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<包内 helpers/window-quiet.ps1>" -Action hide -ProcessId <PID>`
- 用户要用肉眼看效果：先问，同意后 `-Action show` 还原，用完再移出去。
- 全屏独占（`window_mode = fullscreen`）的窗口挪不走：如实说明，或先改成窗口模式再跑。

## 导出

- 先确认 `export_presets.cfg` 里已有对应预设、导出模板已安装，再 `godot_export_project`；缺预设就先建预设，不要盲调导出。
- 导出后跑一次产物，确认启动、资源加载与目标平台行为，而不是只看命令退出码。

## 验证清单

- [ ] 改动的场景/脚本能被引擎加载（无解析错误）
- [ ] 无头测试或运行通过，日志无 error
- [ ] 画面/手感类改动有截图或状态导出对照
- [ ] 导出的预设存在且产物能启动（涉及发布时）
