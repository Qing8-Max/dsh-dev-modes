import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * 每个会话独立的「静默运行」开关（并入 dsh-dev-modes）。
 *
 * 静默（默认）：启动任何 GUI 都必须立刻挪到屏幕外，不挡用户、不抢焦点。
 * 可见：用户允许窗口出现在前台。
 *
 * 存储：$DSH_HOME/storages/dsh-quiet-run/state.json
 *   { "<sessionId>": { "quiet": true, "updatedAt": 1700000000000 } }
 */

const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const STORE_DIR = path.join(HOME, 'storages', 'dsh-quiet-run');
const STORE_FILE = path.join(STORE_DIR, 'state.json');
const LOG_FILE = path.join(STORE_DIR, 'requests.log');

/** 记一行请求日志：排查"点了开关但没生效"时，能看清前端到底传了哪个会话。 */
function logRequest(entry) {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, JSON.stringify({ t: Date.now(), ...entry }) + '\n', 'utf8');
    const stat = fs.statSync(LOG_FILE);
    if (stat.size > 200 * 1024) {
      const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').slice(-200);
      fs.writeFileSync(LOG_FILE, lines.join('\n') + '\n', 'utf8');
    }
  } catch {
    /* 日志失败不影响功能 */
  }
}

/** 与包一起分发的窗口搬运脚本（绝对路径，写进规则里让模型直接可用）。 */
const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HELPER = path.join(PKG_ROOT, 'helpers', 'window-quiet.ps1');
const WATCHER = path.join(PKG_ROOT, 'helpers', 'window-quiet-watch.ps1');
const WATCHER_PID_FILE = path.join(STORE_DIR, 'watcher.pid');
/**
 * 给后台监视器看的标志文件：宿主进程里读不到 web 端口，所以不让 watcher 走 HTTP，
 * 直接由插件在每次读写开关时落一个 { quiet } 文件，watcher 轮询它即可。
 */
const WATCHER_FLAG_FILE = path.join(STORE_DIR, 'watch-flag.json');
const WATCHER_DEBUG_FILE = path.join(STORE_DIR, 'watcher-debug.log');

function appendWatcherDebug(text) {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.appendFileSync(WATCHER_DEBUG_FILE, `${new Date().toISOString()} ${text}\n`, 'utf8');
  } catch {
    /* ignore */
  }
}

/**
 * 后台监视器该不该动手，由「最后一次明确点开关的会话」决定。
 *
 * 试过两种信号都不对：
 * - 用"这次轮询的会话"：多开窗口时互相覆盖，A 开了静默被 B 盖回关闭。
 * - 用"最近轮询过的任意会话，有一个开着就算数"：A 窗口遗留的开启会强行让
 *   别的窗口也静默，与 B 窗口显示的「可见运行」矛盾。
 * 现在改成只看用户最后一次点开关的那一下——所见即所得。
 */
let lastToggle = null;

/** 依据「最后一次点开关的会话」重算静默状态，并落给后台监视器。 */
function syncWatchFlag() {
  if (!lastToggle) {
    // 还没有人点过：按默认（静默）处理
    writeWatchFlag(null, true);
    return;
  }
  writeWatchFlag(lastToggle, isQuiet(lastToggle));
}

function writeWatchFlag(sessionId, quiet) {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(
      WATCHER_FLAG_FILE,
      JSON.stringify({ sessionId: sessionId ?? null, quiet: Boolean(quiet), t: Date.now() }),
      'utf8',
    );
  } catch {
    /* ignore */
  }
}

/**
 * 拉起后台监视器：静默开启时自动把新窗口移出可视区。
 *
 * 为什么要有它：只靠提示词让模型"记得移窗口"不可靠——模型可能没照做、
 * 命令可能失败、执行的人可能根本不是本插件所在的会话。监视器由插件自己
 * 启动，直接读开关状态，不依赖任何模型决策。
 */
function ensureWatcher() {
  try {
    // 已有监视器在跑就复用，避免热重载后堆出一堆进程
    try {
      const existing = parseInt(fs.readFileSync(WATCHER_PID_FILE, 'utf8').trim(), 10);
      if (existing > 0) {
        process.kill(existing, 0);
        return existing;
      }
    } catch {
      /* 没有旧进程或已退出 */
    }

    if (!fs.existsSync(WATCHER)) return null;

    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-File',
        WATCHER,
        '-FlagFile',
        WATCHER_FLAG_FILE,
      ],
      { detached: true, stdio: 'ignore', windowsHide: true },
    );

    // 启动失败时把原因写下来，否则只能看到一个永远不起作用的开关
    child.on('error', (err) => {
      diag.watcherError = String((err && err.message) || err);
      appendWatcherDebug('spawn error: ' + diag.watcherError);
    });
    child.on('exit', (code) => {
      appendWatcherDebug('cmd launcher exited: ' + code);
    });
    child.unref();
    try {
      fs.mkdirSync(STORE_DIR, { recursive: true });
      fs.writeFileSync(WATCHER_PID_FILE, String(child.pid), 'utf8');
    } catch {
      /* ignore */
    }
    return child.pid;
  } catch (err) {
    noteError('ensureWatcher', err);
    return null;
  }
}

function stopWatcher() {
  try {
    const pid = parseInt(fs.readFileSync(WATCHER_PID_FILE, 'utf8').trim(), 10);
    if (pid > 0) {
      try {
        process.kill(pid);
      } catch {
        /* ignore */
      }
    }
    fs.rmSync(WATCHER_PID_FILE, { force: true });
  } catch {
    /* ignore */
  }
}

const QUIET_RULE = [
  '## 静默运行（本会话已开启）',
  '',
  '用户可能正在看视频或打字。启动任何 GUI 都不得挡住他、不得抢走焦点。',
  '',
  '- **优先无窗口**：构建、测试、lint、类型检查、逻辑验证一律用无界面方式（headless / batchmode / 纯命令行）',
  '- **启动 GUI 之后必须立刻把它移出可视区**，别只说不做。命令：',
  '  ```',
  `  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${HELPER}" -Action hide -ProcessId <刚启动的进程号>`,
  `  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${HELPER}" -Action hide -Title "<窗口标题片段>"`,
  `  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${HELPER}" -Action list   # 查当前可见窗口`,
  '  ```',
  '- 用户要用肉眼看效果时：先问，得到同意后 `-Action show` 还原。用完记得再移出去。',
  '- 不要全屏；不要主动激活、置顶、聚焦窗口。',
  '- 预计超过 1 分钟的构建或测试（首次导入、cook、导出、编译大项目）先说明再跑。',
  '- `hide` 失败（例如全屏独占窗口）时**如实告诉用户"这个窗口挪不走"**，不要假装已经藏起来。',
].join('\n');

const VISIBLE_RULE = [
  '## 可见运行（本会话已开启）',
  '',
  '用户允许窗口出现在前台，可以正常启动并显示 GUI。',
  '',
  '仍然不要主动抢焦点：窗口按需启动即可，不必刻意隐藏。',
].join('\n');

/** sessionId -> { quiet: boolean, updatedAt: number } */
let states = {};
const agents = new Map();
let activeSessionId = null;

const diag = {
  pluginLoaded: true,
  createdEvents: 0,
  listedAtStartup: 0,
  errors: [],
};

function noteError(where, err) {
  if (diag.errors.length > 10) diag.errors.shift();
  diag.errors.push(where + ': ' + String((err && err.message) || err));
}

function ensureDir() {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) states = parsed;
  } catch {
    states = {};
  }
}

function persist() {
  try {
    ensureDir();
    fs.writeFileSync(STORE_FILE, JSON.stringify(states, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** 默认静默：没有记录的会话按"别挡我"处理。 */
function isQuiet(sessionId) {
  if (!sessionId) return true;
  const entry = states[sessionId];
  if (!entry || typeof entry.quiet !== 'boolean') return true;
  return entry.quiet;
}

/**
 * 提示词里用这个：每次都从磁盘重读。
 * 会话作用域里已注册的变量在插件热重载后不会被新实例覆盖，旧闭包仍在求值，
 * 让双方都读磁盘就不会出现"界面显示已切换、提示词没变"。
 */
function isQuietFresh(sessionId) {
  load();
  return isQuiet(sessionId);
}

function setQuiet(sessionId, quiet) {
  if (!sessionId) return false;
  states[sessionId] = { quiet: Boolean(quiet), updatedAt: Date.now() };
  return persist();
}

function sessionIdOf(agent) {
  if (!agent) return null;
  const tries = [
    () => agent.session?.id,
    () => agent.session?.sessionId,
    () => agent.sessionId,
    () => agent.session?.session?.id,
  ];
  for (const t of tries) {
    try {
      const v = t();
      if (typeof v === 'string' && v) return v;
    } catch (err) {
      noteError('sessionIdOf', err);
    }
  }
  return null;
}

function attachPrompt(agent, sessionId) {
  try {
    agent.ctx.systemPrompt.variable('quiet_run_rule', () =>
      isQuietFresh(sessionId) ? QUIET_RULE : VISIBLE_RULE,
    );
    agent.ctx.systemPrompt.section({
      name: 'quiet-run',
      order: 901,
      text: '{{quiet_run_rule}}',
    });
    return true;
  } catch (err) {
    if (!diag.attachPromptNoted) {
      diag.attachPromptNoted = true;
      noteError('attachPrompt', err);
    }
    return false;
  }
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e5) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

export function apply(ctx) {
  load();

  // 后台监视器：静默开启时自动搬走新窗口，不依赖模型是否照做。
  // 由脚本自己保证单实例，插件这边只管确保有人被拉起（热重载不会堆进程）。
  const watcherPid = ensureWatcher();
  diag.watcherPid = watcherPid;

  const register = (agent) => {
    try {
      const sessionId = sessionIdOf(agent);
      if (!sessionId) return;
      agents.set(sessionId, agent);
      activeSessionId = sessionId;
      attachPrompt(agent, sessionId);
    } catch (err) {
      noteError('register', err);
    }
  };

  ctx.inject(['agents'], (c) => {
    try {
      const live = c.agents.list();
      diag.listedAtStartup = Array.isArray(live) ? live.length : 0;
      for (const item of live || []) register(item?.agent ?? item);
    } catch (err) {
      noteError('agents.list', err);
    }
  });

  ctx.effect(() => {
    const off = ctx.on('agent/created', (payload) => {
      diag.createdEvents += 1;
      register(payload?.agent ?? payload);
    });
    return () => {
      if (typeof off === 'function') off();
      agents.clear();
    };
  });

  // 用户在某会话里发消息时把"当前会话"锁定为用户正在用的那个。
  ctx.effect(() => {
    const off = ctx.on('api-session/activity', (sessionId) => {
      if (typeof sessionId === 'string' && sessionId) activeSessionId = sessionId;
    });
    return () => {
      if (typeof off === 'function') off();
    };
  });

  ctx.inject(['webServer'], (c) => {
    c.effect(() => {
      const sendJson = (res, status, obj) => {
        res.writeHead(status, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        });
        res.end(JSON.stringify(obj));
      };

      /**
       * 宿主认证：这些路由会读出/改写某个会话的静默状态，必须和 DSH 自己的 API 用同一道闸。
       * `connection.requestRejection` 同时做 Host/Origin 检查与浏览器登录校验：
       * 没有登录凭据、或来自别的站点，都拿不到 401/403 以外的结果。
       * 拿不到这道闸（没有 connection 服务）时按失败关闭处理，不做"看来源地址"之类的猜测。
       * @returns true 表示已经拒绝并写完响应，调用方直接 return。
       */
      const rejectedByHost = (req, res) => {
        let rejection;
        try {
          const connection = c.get('connection');
          if (typeof connection?.requestRejection !== 'function') throw new Error('admission unavailable');
          rejection = connection.requestRejection(req);
        } catch {
          sendJson(res, 503, { error: 'host admission unavailable' });
          return true;
        }
        if (rejection !== undefined) {
          sendJson(res, rejection === 401 ? 401 : 403, { error: 'unauthenticated' });
          return true;
        }
        return false;
      };

      const state = c.webServer.register({
        kind: 'exact',
        path: '/dsh-quiet-run/state',
        handler: async (req, res) => {
          if (rejectedByHost(req, res)) return;
          const url = new URL(req.url || '/', 'http://127.0.0.1');
          const asked = url.searchParams.get('sessionId');
          const sessionId = asked || activeSessionId;
          const quietNow = sessionId ? isQuiet(sessionId) : true;
          logRequest({ kind: 'state', asked: asked ?? null, resolved: sessionId, fromActive: !asked });
          if (!sessionId) {
            sendJson(res, 200, { sessionId: null, quiet: true, ready: false, diag });
            return;
          }
          sendJson(res, 200, {
            sessionId,
            quiet: isQuiet(sessionId),
            ready: true,
            tracked: agents.has(sessionId),
            diag,
          });
        },
      });

      const toggle = c.webServer.register({
        kind: 'exact',
        path: '/dsh-quiet-run/set',
        handler: async (req, res) => {
          if (rejectedByHost(req, res)) return;
          if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'POST only' });
            return;
          }
          const body = await readJsonBody(req);
          const sessionId = body.sessionId || activeSessionId;
          logRequest({
            kind: 'set',
            bodySession: body.sessionId ?? null,
            resolved: sessionId,
            fromActive: !body.sessionId,
            value: body.quiet,
          });
          if (!sessionId) {
            sendJson(res, 400, { error: 'no active session yet' });
            return;
          }
          const quiet = Boolean(body.quiet);
          const saved = setQuiet(sessionId, quiet);
          lastToggle = sessionId;
          syncWatchFlag();
          sendJson(res, 200, { sessionId, quiet, saved });
        },
      });

      const dumpLog = c.webServer.register({
        kind: 'exact',
        path: '/dsh-quiet-run/log',
        handler: async (req, res) => {
          if (rejectedByHost(req, res)) return;
          let lines = [];
          try {
            lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').slice(-60);
          } catch {
            lines = [];
          }
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          });
          res.end(JSON.stringify({ activeSessionId, entries: lines }));
        },
      });

      return () => {
        state();
        toggle();
        dumpLog();
      };
    });
  });
}