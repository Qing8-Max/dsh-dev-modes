---
name: game-unity
description: Unity 引擎工作流：批处理运行、编辑器方法、Test Framework（EditMode/PlayMode）、BuildPipeline 构建、.meta/场景/预制体约定与权限注意；项目含 Assets/ + ProjectSettings/ProjectVersion.txt 时加载。
whenToUse: 项目有 Assets/、ProjectSettings/ProjectVersion.txt、*.unity 场景或 *.prefab，需要跑编辑器、写测试、构建或改资产时。
---

# Unity 工作流

## 识别与结构

- 版本：`ProjectSettings/ProjectVersion.txt`（`m_EditorVersion`），据此找对应 `Unity.exe`（Unity Hub 安装目录）。
- 关键路径：`Assets/` 资源与脚本、`Assets/Editor/` 编辑器脚本、`.asmdef` 汇编定义、`Packages/manifest.json` 依赖。
- 资产类型：`*.unity` 场景、`*.prefab` 预制体、`*.asset`（ScriptableObject）、`*.mat`、`*.anim`。
- `.meta` 文件必须与资产同生共死：不要手删、不要只拷资产不拷 meta；缺失会重新生成 uuid 导致引用全断。
- 生成物不进版本库：`Library/`、`Temp/`、`Logs/`、`obj/`、`Build/`（以项目 `.gitignore` 为准）。

## 批处理运行

```powershell
& "<UnityEditor>\Unity.exe" -batchmode -nographics -quit `
  -projectPath "<项目>" -logFile "<日志路径>"
```

- 退出码非 0 时先读 `-logFile` 的编译错误；`-quit` 让编辑器跑完退出。
- 编辑器方法：加 `-executeMethod "Namespace.Class.Method"`，方法必须在 `Editor/` 程序集里可见，参数从 `-projectPath` 等命令行读取。

## 测试（Unity Test Framework）

```powershell
& "<UnityEditor>\Unity.exe" -batchmode -nographics -projectPath "<项目>" `
  -runTests -testPlatform EditMode -testResults "<results.xml>"
```

- 先 EditMode（纯逻辑），再 PlayMode（运行期行为）；`-testPlatform PlayMode` 需要能进播放模式。
- 结果读 `results.xml`（NUnit 格式），失败用例与堆栈在这里，不要只看退出码。

## 构建

- 用 `-executeMethod` 调项目自己的构建脚本（`BuildPipeline.BuildPlayer`），目标平台用 `-buildTarget`（如 `StandaloneWindows64`）。
- 产物路径以构建脚本为准；没有构建脚本就先写一个最小 Editor 脚本，再接入。
- 构建后至少启动产物一次，确认场景与资源加载。

## 权限与沙箱

- Unity 会写 `%LOCALAPPDATA%\Unity`、`%APPDATA%\UnityHub` 与许可证缓存；命令因写权限失败时，切到完全访问权限重跑，不要改引擎设置绕过。
- 首次导入/编译可能很慢，用后台作业跑，别让前台超时。

## 工程纪律

- 序列化保持 Force Text（`ProjectSettings/EditorSettings.asset`）；场景/预制体优先用编辑器脚本或小范围 YAML 修改，不要整文件重写。
- 改公共脚本 API 前先搜引用；`asmdef` 边界要遵守，别把运行时逻辑塞进 Editor 程序集。
- 不删用户场景、预制体、美术与 `.meta`；需要清理先进版本库或问用户。

## 验证清单

- [ ] 批处理编译无 error（日志确认）
- [ ] 相关测试通过（results.xml）
- [ ] 构建成功且产物能启动（涉及发布时）
- [ ] 场景/预制体改动在编辑器里打开无丢失引用
