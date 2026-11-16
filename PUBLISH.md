# 发布到插件市场

插件市场（Discover 页 / `plugin_market` 工具）读的是**你配置的索引 URL**：一个 HTTPS 上的 JSON 文件（格式 1），每条记录指向一个可安装的 npm 包或公开 Git 仓库的某个 commit。DSH 自带校验器 `@deepseek-ai/dsh-plugin-market-index` 决定格式。

## 当前状态：已上线

| 环节 | 结果 |
|---|---|
| npm 包 | `dsh-dev-modes@1.0.0` — https://www.npmjs.com/package/dsh-dev-modes |
| 索引托管 | GitHub Gist（公开）：https://gist.github.com/Qing8-Max/ccfef4b20e497b3d0499d632dc774598 |
| 索引 URL | `https://gist.githubusercontent.com/Qing8-Max/ccfef4b20e497b3d0499d632dc774598/raw/dsh-market.json` |
| DSH 配置 | profile `cordis.patch.yml` 的 `plugin-market` 行已写入该索引 |
| 运行时验证 | `listIndexes` 读到标题/描述（来自 Gist 实时抓取）；`entry()` 返回兼容性 `compatible: true`、安装参数 `dsh-dev-modes@1.0.0`、安装状态 `installed` |

索引文件与图标源码都在 `dist/gist/`（`dsh-market.json` + `icon.svg`）。

### 改索引内容后怎么更新

Gist 直接编辑即可（网址不变、raw URL 不变，DSH 有 `cacheTtlMs` 默认 10 分钟缓存）：

```powershell
gh gist edit ccfef4b20e497b3d0499d632dc774598 -a dist/gist/dsh-market.json -a dist/gist/icon.svg
```

发新版本时记得同步 `versions` 数组：加一条新版本对象并把 `publishTimestamp` 写对（Unix 秒）。

---

以下为通用发布流程（换名字/换托管方式时参考）。

## 发布一个新包需要三步

### 1. 把包发布出去（二选一）

**npm**
```powershell
npm publish --access public
```
包名是 `dsh-dev-modes`（无作用域、可公开发布）。然后索引里用 `"source": { "type": "npm" }`，`version` 写已发布的版本号。

> 注意：npm 现在对新包走「暂存发布」——首次 publish 会先出现 `0.0.0-stage` 占位版本并返回成功，真实版本约 4 分钟后才出现在 registry，期间重复 publish 会报 `409 Cannot publish over previously staged version`。

**公开 Git 仓库**
推到一个公开仓库，取 40 位 commit SHA：
```json
"source": {
  "type": "git",
  "url": "https://github.com/<user>/<repo>",
  "commit": "<40-hex-sha>",
  "path": "dev-modes"
}
```
`path` 是包目录在仓库里的相对路径（就是本目录）。

### 2. 托管索引

把 `market-index.example.json` 改成上面实际来源，放到任意 **HTTPS** 静态地址（GitHub Pages、Gist raw、对象存储都可以）。索引 URL 不能带查询串或 fragment，也不能含账号密码。

### 3. 在 DSH 里添加索引

- 界面：插件页 → Discover → 添加索引源，填索引 URL。
- 或让配置写进 `plugin-market` 行的 `indexes`（Settings 里改更稳妥）。
- 添加后 Discover 里应出现「开发模式合集」，点安装即走 `installBundle`。

## 不发布也能分发

- 直接把本目录（或 `pnpm pack` 生成的 tgz）给另一台机器：
  - 插件页 → Add plugin → 选择本目录；
  - 或 `plugin_manager` → `install_bundle` → target = 本目录绝对路径。
- 目标机器需要能解析本目录里的 `dsh-dev-modes` 依赖（本地目录安装会自动处理）。

## 校验索引

改完索引后，用 DSH 自带校验器验证（这台机器上可直接跑）：

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& $env:DSH_NODE_EXECUTABLE C:\Users\huang\dsh-modes\dev-modes\dist\validate-market-index.mjs <索引文件> [索引URL]
```

输出 `ok: true` 与每个版本的安装参数即为合法；否则会报 `$.plugins[0].versions[0].version ...` 这类带 JSON 路径的错误。
