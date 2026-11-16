import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * 每个会话独立的「会话隔离」开关（并入 dsh-dev-modes）。
 *
 * 锁定（默认）：该会话的系统提示禁止读取其它会话的文件。
 * 开放：不额外注入规则，回到全局 AGENTS.md 的约束。
 *
 * 存储：$DSH_HOME/storages/dsh-session-lock/policies.json
 *   { "<sessionId>": { "locked": true, "updatedAt": 1700000000000 } }
 *
 * 目录名沿用独立插件时期的名字，升级后原有设置继续生效。
 */

const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const STORE_DIR = path.join(HOME, 'storages', 'dsh-session-lock');
const STORE_FILE = path.join(STORE_DIR, 'policies.json');

const LOCKED_RULE = [
  '## 会话隔离（本会话已锁定）',
  '',
  '本会话被用户设置为**隔离模式**。禁止读取其他会话的任何内容：',
  '',
  '- 不要读取、列举、搜索 `~/.dsh/sessions/` 或 `~/.dsh/storages/session_projcache/sessions/` 下的文件',
  '- 不要用 read / grep / glob / pwsh / read_image 等任何工具去翻看历史会话',
  '- 不要为了补充上下文而自行查找过去的对话',
  '',
  '如果任务确实需要历史信息，先询问用户，由用户决定是否提供。',
].join('\n');

/** sessionId -> { locked: boolean, updatedAt: number } */
let policies = {};
/** sessionId -> Agent，用于按会话注册提示词 */
const agents = new Map();
let activeSessionId = null;

const diag = {
  pluginLoaded: true,
  createdEvents: 0,
  listedAtStartup: 0,
  lastSessionProbe: null,
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
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) policies = parsed;
  } catch {
    policies = {};
  }
}

function persist() {
  try {
    ensureDir();
    fs.writeFileSync(STORE_FILE, JSON.stringify(policies, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** 默认锁定：没有记录的会话不得读取其它会话。 */
function isLocked(sessionId) {
  if (!sessionId) return true;
  const entry = policies[sessionId];
  if (!entry || typeof entry.locked !== 'boolean') return true;
  return entry.locked;
}

/**
 * 提示词里用这个：每次都从磁盘重读。
 * 会话作用域里已注册的变量在插件热重载后不会被新实例覆盖，旧闭包仍在求值，
 * 让双方都读磁盘就不会出现"界面显示已切换、提示词没变"。
 */
function isLockedFresh(sessionId) {
  load();
  return isLocked(sessionId);
}

function setLocked(sessionId, locked) {
  if (!sessionId) return false;
  policies[sessionId] = { locked: Boolean(locked), updatedAt: Date.now() };
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
      if (typeof v === 'string' && v) {
        diag.lastSessionProbe = v;
        return v;
      }
    } catch (err) {
      noteError('sessionIdOf', err);
    }
  }
  return null;
}

function attachPrompt(agent, sessionId) {
  try {
    agent.ctx.systemPrompt.variable('session_lock_rule', () =>
      isLockedFresh(sessionId) ? LOCKED_RULE : '',
    );
    agent.ctx.systemPrompt.section({
      name: 'session-lock',
      order: 900,
      text: '{{session_lock_rule}}',
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
        path: '/dsh-session-lock/state',
        handler: async (req, res) => {
          const url = new URL(req.url || '/', 'http://127.0.0.1');
          const asked = url.searchParams.get('sessionId');
          const sessionId = asked || activeSessionId;
          if (!sessionId) {
            sendJson(res, 200, { sessionId: null, locked: true, ready: false, diag });
            return;
          }
          sendJson(res, 200, {
            sessionId,
            locked: isLocked(sessionId),
            ready: true,
            tracked: agents.has(sessionId),
            diag,
          });
        },
      });

      const toggle = c.webServer.register({
        kind: 'exact',
        path: '/dsh-session-lock/set',
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
          const locked = Boolean(body.locked);
          const saved = setLocked(sessionId, locked);
          sendJson(res, 200, { sessionId, locked, saved });
        },
      });

      return () => {
        state();
        toggle();
      };
    });
  });
}