---
name: game-cocos
description: Cocos Creator 工作流：命令行构建、场景/Prefab、TypeScript 组件与 .meta/uuid 约定、Web 产物验证；项目含 assets/ + settings/ + package.json 时加载。
whenToUse: 项目有 assets/、settings/、*.scene 或 *.prefab，用的是 Cocos Creator，需要构建、改场景或写脚本时。
---

# Cocos Creator 工作流

## 识别与结构

- 版本：`package.json` 与 `settings/`（3.x 常在 `settings/v2/packages`）判断 2.x / 3.x；两者命令行参数不同，先 `--help` 确认。
- 结构：`assets/`（场景、预制体、脚本、资源）、`settings/`（项目设置）、`build/`（构建产物）。
- 资源旁边的 `*.meta` 保存 uuid：不要手删、不要手改 uuid；重命名/移动资源用编辑器或资源库工具，否则引用全断。
- 脚本：TypeScript 放 `assets/scripts`，组件用 `@ccclass` / `@property`，组件挂载关系写在场景/预制体里。

## 构建

```powershell
& "<CocosCreator>\CocosCreator.exe" --project "<项目>" --build "platform=web-desktop;debug=true"
```

- 3.x 用 `--build` 携带平台参数；2.x 参数不同（如 `--build "platform=web-mobile"`），以本机版本 `--help` 为准。
- 产物在 `build/<platform>/`；构建日志会报资源缺失与脚本编译错误。
- 首次构建会生成/更新 `library/`、`temp/` 等中间目录，属生成物，不进版本库。

## 脚本与逻辑验证

- Creator 没有内置单测框架：纯逻辑模块抽成不依赖引擎的 TS，用 node/jest 直接测。
- 引擎相关行为（生命周期、节点树、物理、UI）要在构建产物或编辑器预览里真实运行验证。
- Web 产物可用本地静态服务器打开；桌面/小游戏平台按目标平台的实际运行方式验证。

## 权限与沙箱

- Creator 构建会写用户目录缓存与编辑器设置；权限失败时切完全访问权限重跑，不要改项目配置绕过。

## 工程纪律

- 场景/预制体是结构化文本（JSON），改动尽量小、可 diff；不要整文件重排。
- 改脚本公共接口前搜引用；组件 `@property` 改名会影响场景序列化，需同步迁移。
- 不删用户资源与 `.meta`；需要清理先问。

## 验证清单

- [ ] 构建成功（日志无资源缺失/脚本错误）
- [ ] 产物能启动，改动涉及的场景行为符合验收
- [ ] 资源与 `.meta` 成对存在，场景打开无丢失引用
