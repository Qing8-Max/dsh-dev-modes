window.__ModuleLoader__.load({
  id: 'dsh-dev-modes',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const baseBtn = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      height: 28,
      padding: '0 8px',
      border: '1px solid rgba(128,128,128,0.35)',
      borderRadius: 8,
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
      fontSize: 13,
      lineHeight: 1,
      cursor: 'pointer',
    };

    async function getJson(url) {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    }

    async function postJson(url, body) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let detail = '';
        try {
          const j = await res.json();
          detail = (j && j.error) || '';
        } catch (e) {}
        throw new Error('HTTP ' + res.status + ' ' + detail);
      }
      return await res.json();
    }

    function stateUrl(apiPath, sessionId) {
      return apiPath + '/state' + (sessionId ? '?sessionId=' + encodeURIComponent(sessionId) : '');
    }

    /**
     * 一个开关按钮。
     * sessionId 来自插槽标准 props —— 必须带上，否则宿主只能猜"当前会话"，
     * 多开窗口时会写到别的会话去（表现就是"点了没反应 / 关不掉"）。
     */
    function SwitchButton({ apiPath, sessionId, swKey, iconOn, iconOff, labelOn, labelOff, titleOn, titleOff }) {
      const [value, setValue] = React.useState(true);
      const [ready, setReady] = React.useState(false);
      const [busy, setBusy] = React.useState(false);
      const [note, setNote] = React.useState('');

      const refresh = React.useCallback(async () => {
        try {
          const s = await getJson(stateUrl(apiPath, sessionId));
          setReady(Boolean(s.ready));
          setValue(s[swKey] !== false);
        } catch (e) {
          setReady(false);
        }
      }, [apiPath, sessionId, swKey]);

      React.useEffect(() => {
        refresh();
        const id = setInterval(refresh, 5000);
        return () => clearInterval(id);
      }, [refresh]);

      const onClick = async () => {
        if (busy || !ready) return;
        setBusy(true);
        setNote('');
        const next = !value;
        try {
          await postJson(apiPath + '/set', { sessionId, [swKey]: next });
          setValue(next);
          setNote(next ? '已开启' : '已关闭');
          setTimeout(() => setNote(''), 3000);
          setTimeout(refresh, 300);
        } catch (e) {
          setNote('切换失败：' + ((e && e.message) || String(e)));
          setTimeout(() => setNote(''), 6000);
        } finally {
          setBusy(false);
        }
      };

      const icon = !ready ? '⏳' : value ? iconOn : iconOff;
      const label = !ready ? '未就绪' : value ? labelOn : labelOff;
      const title = !ready
        ? sessionId
          ? '本会话尚未建立，稍后再试'
          : '还没有会话，稍后再试'
        : value
          ? titleOn
          : titleOff;

      return h(
        'div',
        { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
        h(
          'button',
          {
            type: 'button',
            onClick,
            disabled: busy || !ready,
            title,
            style: Object.assign({}, baseBtn, busy || !ready ? { opacity: 0.55 } : null),
          },
          h('span', { style: { fontSize: 14 } }, icon),
          h('span', { style: { fontSize: 12, opacity: 0.85 } }, label),
        ),
        note ? h('span', { style: { fontSize: 12, opacity: 0.75, whiteSpace: 'nowrap' } }, note) : null,
      );
    }

    function DevModeSwitch(props) {
      const sessionId = props && props.sessionId;
      return h(
        'div',
        { style: { display: 'inline-flex', alignItems: 'center', gap: 8 } },
        h(SwitchButton, {
          apiPath: '/dsh-session-lock',
          sessionId,
          swKey: 'locked',
          iconOn: '🔒',
          iconOff: '🔓',
          labelOn: '禁止读其它会话',
          labelOff: '允许读其它会话',
          titleOn: '当前会话已锁定：不会读取其它会话的内容。点击允许。',
          titleOff: '当前会话已允许：可以读取其它会话。点击锁定。',
        }),
        h(SwitchButton, {
          apiPath: '/dsh-quiet-run',
          sessionId,
          swKey: 'quiet',
          iconOn: '🔇',
          iconOff: '🔊',
          labelOn: '静默运行',
          labelOff: '可见运行',
          titleOn: '静默运行：启动游戏或编辑器时会挪到屏幕外，不挡你、不抢焦点。点击改为可见。',
          titleOff: '可见运行：允许窗口出现在前台。点击改回静默。',
        }),
      );
    }

    /** 删除会话：移到隔离目录（可恢复），不做物理删除。 */
    async function deleteSession(sessionId) {
      const ok = window.confirm(
        '删除这个会话？\n\n' +
          '它会被移到 .dsh\\sessions-trash\\<时间戳>\\，可以从那里恢复；\n' +
          '确认不要了再手动清理该目录。',
      );
      if (!ok) return;
      try {
        const r = await postJson('/dsh-session-delete/delete', { sessionId });
        if (!r || r.ok !== true) {
          window.alert('删除失败：' + ((r && r.error) || '未知错误'));
          return;
        }
        window.alert(
          r.removed > 0
            ? '已移到隔离目录：\n' + (r.trashPath || '') + '\n\n刷新页面后该会话就会从列表消失。'
            : '没有找到这个会话的目录（可能已经删过了）。',
        );
      } catch (e) {
        window.alert('删除失败：' + ((e && e.message) || String(e)));
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            { name: 'conversation.composer.dock', id: 'dsh-dev-modes', order: 4 },
            DevModeSwitch,
          ),
        );

        // 会话右键菜单：删除会话
        ctx.inject(['contextMenus'], (c) => {
          c.effect(() =>
            c.contextMenus.register({
              id: 'session.delete',
              target: 'session',
              order: 300,
              observe: () => [],
              resolve(target) {
                const sessionId = target && target.sessionId;
                if (!sessionId) return [];
                return [
                  {
                    id: 'delete',
                    label: '删除会话',
                    run: () => deleteSession(sessionId),
                  },
                ];
              },
            }),
          );
        });
      },
    };
  },
});