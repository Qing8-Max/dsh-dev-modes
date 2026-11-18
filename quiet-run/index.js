import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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

/** 与包一起分发的窗口搬运脚本（绝对路径，写进规则里让模型直接可用）。 */
const HELPER = path.join(
  path.dirname(path.dirname(fileURLToPath(import.meta.url))),
  'helpers',
  'window-quiet.ps1',
);

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

      const state = c.webServer.register({
        kind: 'exact',
        path: '/dsh-quiet-run/state',
        handler: async (req, res) => {
          const url = new URL(req.url || '/', 'http://127.0.0.1');
          const asked = url.searchParams.get('sessionId');
          const sessionId = asked || activeSessionId;
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
          if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'POST only' });
            return;
          }
          const body = await readJsonBody(req);
          const sessionId = body.sessionId || activeSessionId;
          if (!sessionId) {
            sendJson(res, 400, { error: 'no active session yet' });
            return;
          }
          const quiet = Boolean(body.quiet);
          const saved = setQuiet(sessionId, quiet);
          sendJson(res, 200, { sessionId, quiet, saved });
        },
      });

      return () => {
        state();
        toggle();
      };
    });
  });
}