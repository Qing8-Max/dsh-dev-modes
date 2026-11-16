---
name: game-unreal
description: Unreal Engine 工作流：Build.bat 编译、UnrealEditor-Cmd 与 Automation 测试、RunUAT BuildCookRun 打包、uasset/umap 资产约定与权限注意；项目含 *.uproject 时加载。
whenToUse: 项目有 *.uproject、Source/*.Target.cs、Config/ 与 Content/，需要编译 C++、跑自动化测试、cook/打包或改资产时。
---

# Unreal Engine 工作流

## 识别与结构

- 版本：`<项目>.uproject` 的 `EngineAssociation`；引擎根目录通常在 `UE_ROOT` 环境变量或 `C:\Program Files\Epic Games\UE_<版本>`。
- 结构：`Source/`（C++ 模块与 `*.Target.cs` / `*.Build.cs`）、`Config/*.ini`、`Content/`（资产）、`Plugins/*.uplugin`。
- 资产是二进制：`.uasset`、`.umap` 不要手改；蓝图逻辑不可 diff，便于评审的改动优先 C++、数据表与 `Config/*.ini`。
- 生成物不进版本库：`Binaries/`、`Intermediate/`、`Saved/`、`DerivedDataCache/`。

## 编译

```powershell
& "<Engine>\Engine\Build\BatchFiles\Build.bat" <Target> Win64 Development `
  -project="<项目>\<项目>.uproject" -waitmutex
```

- 失败先读编译输出；`-waitmutex` 避免并行实例互锁。
- 改 C++ 头文件后需要完整重建，不要只靠 Live Coding 验证发布行为。

## 运行与自动化测试

```powershell
& "<Engine>\Engine\Binaries\Win64\UnrealEditor-Cmd.exe" "<项目>.uproject" `
  -run=<Commandlet> -unattended -nullrhi -log
```

- 自动化测试：`-ExecCmds="Automation RunTests <Filter>; Quit"`、`-testexit="Automation Test Queue Empty"`；结果与日志在 `Saved/Automation/`、`Saved/Logs/`。
- `-nullrhi` 跳过渲染，适合逻辑测试；渲染/画面问题必须在真实运行里看。

## 打包（BuildCookRun）

```powershell
& "<Engine>\Engine\Build\BatchFiles\RunUAT.bat" BuildCookRun `
  -project="<项目>.uproject" -noP4 -platform=Win64 -clientconfig=Development `
  -build -cook -stage -pak -archive -archivedirectory="<产物目录>"
```

- 需要已安装引擎与 DDC；首次 cook 很慢，用后台作业跑。
- 改资产后至少 cook 一次，确认引用完整；cook/pak 失败会指出缺失资源。

## 权限与沙箱

- UAT/编辑器会写 `%LOCALAPPDATA%\UnrealEngine`、DDC 与派生数据；权限失败时切完全访问权限重跑，不要伪造或复用别人的缓存。

## 工程纪律

- 改公共 C++ 接口前搜引用；模块依赖写进 `.Build.cs`，不要靠 include 路径硬凑。
- 蓝图/资产改动尽量集中并且说明意图；避免整包重存产生海量二进制 diff。
- 不删用户的 `Content/` 资产与 `.umap`；清理先问。

## 验证清单

- [ ] 编译通过（Build.bat 退出码与输出）
- [ ] 自动化测试通过（Saved/Automation 结果）
- [ ] cook/pak 成功且产物能启动（涉及发布时）
- [ ] 资产改动后无丢失引用（cook 无缺失资源报错）
