import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 会话删除（并入 dsh-dev-modes）。
 *
 * 设计原则：**不直接删，只隔离**。
 * 会话目录整体移动到 `$DSH_HOME/sessions-trash/<时间戳>/`，
 * 想找回随时移回；确认不要了再由用户手动清理。
 *
 * 端点：
 *   POST /dsh-session-delete/delete  { sessionId }  -> { ok, removed, trashPath }
 *   GET  /dsh-session-delete/trash                   -> { entries: [...] }
 */

const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const SESSIONS_DIR = path.join(HOME, 'sessions');
const TRASH_DIR = path.join(HOME, 'sessions-trash');

/** DSH 的会话 id 形如 session-<uuid>。 */
const SESSION_ID_RE = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isInside(parent, child) {
  const p = path.resolve(parent) + path.sep;
  const c = path.resolve(child);
  return c.startsWith(p);
}

/** 在所有工作区目录下找这个会话的目录（可能命中 0 或 1 个）。 */
function locateSessionDirs(sessionId) {
  if (!fs.existsSync(SESSIONS_DIR)) return [];
  const found = [];
  for (const entry of fs.readdirSync(SESSIONS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(SESSIONS_DIR, entry.name, sessionId);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) found.push(candidate);
  }
  return found;
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 把会话目录移动到隔离区；返回实际落点。 */
function quarantineSession(sessionId) {
  if (!SESSION_ID_RE.test(sessionId)) throw new Error('invalid session id');
  const dirs = locateSessionDirs(sessionId);
  if (dirs.length === 0) return { removed: 0, trashPath: null };

  const batch = path.join(TRASH_DIR, timestamp());
  fs.mkdirSync(batch, { recursive: true });

  let removed = 0;
  let lastTarget = null;
  for (const dir of dirs) {
    // 双保险：只动 sessions 目录内的东西
    if (!isInside(SESSIONS_DIR, dir)) throw new Error('refused: path outside sessions dir');
    const workspaceName = path.basename(path.dirname(dir));
    const target = path.join(batch, workspaceName + '__' + sessionId);
    fs.renameSync(dir, target);
    removed += 1;
    lastTarget = target;
  }
  return { removed, trashPath: batch };
}

function listTrash() {
  if (!fs.existsSync(TRASH_DIR)) return [];
  const out = [];
  for (const batch of fs.readdirSync(TRASH_DIR, { withFileTypes: true })) {
    if (!batch.isDirectory()) continue;
    const batchPath = path.join(TRASH_DIR, batch.name);
    let items = [];
    try {
      items = fs.readdirSync(batchPath, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      items = [];
    }
    out.push({ batch: batch.name, items });
  }
  return out.sort((a, b) => (a.batch < b.batch ? 1 : -1));
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
  ctx.inject(['webServer'], (c) => {
    c.effect(() => {
      const sendJson = (res, status, obj) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify(obj));
      };

      /**
       * 宿主认证：这两个路由会把会话目录移进隔离区、或列出隔离区内容，必须和 DSH 自己的 API 用同一道闸。
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
          sendJson(res, 503, { ok: false, error: 'host admission unavailable' });
          return true;
        }
        if (rejection !== undefined) {
          sendJson(res, rejection === 401 ? 401 : 403, { ok: false, error: 'unauthenticated' });
          return true;
        }
        return false;
      };

      const del = c.webServer.register({
        kind: 'exact',
        path: '/dsh-session-delete/delete',
        handler: async (req, res) => {
          if (rejectedByHost(req, res)) return;
          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, error: 'POST only' });
            return;
          }
          try {
            const body = await readJsonBody(req);
            const sessionId = String(body.sessionId || '');
            const result = quarantineSession(sessionId);
            sendJson(res, 200, { ok: true, ...result });
          } catch (err) {
            sendJson(res, 400, { ok: false, error: String((err && err.message) || err) });
          }
        },
      });

      const trash = c.webServer.register({
        kind: 'exact',
        path: '/dsh-session-delete/trash',
        handler: async (req, res) => {
          if (rejectedByHost(req, res)) return;
          try {
            sendJson(res, 200, { ok: true, entries: listTrash() });
          } catch (err) {
            sendJson(res, 500, { ok: false, error: String((err && err.message) || err) });
          }
        },
      });

      return () => {
        del();
        trash();
      };
    });
  });
}