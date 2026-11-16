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

    /** 通用开关按钮：读一次状态，之后每 5 秒刷新。 */
    function useSwitch(apiPath, key, fallback) {
      const [value, setValue] = React.useState(fallback);
      const [ready, setReady] = React.useState(false);

      const refresh = React.useCallback(async () => {
        try {
          const s = await getJson(apiPath + '/state');
          setReady(Boolean(s.ready));
          setValue(s[key] !== false);
        } catch (e) {
          setReady(false);
        }
      }, [apiPath, key]);

      React.useEffect(() => {
        refresh();
        const id = setInterval(refresh, 5000);
        return () => clearInterval(id);
      }, [refresh]);

      const set = React.useCallback(
        async (next) => {
          await postJson(apiPath + '/set', { [key]: next });
          setValue(next);
        },
        [apiPath, key],
      );

      return { value, ready, set };
    }

    function SwitchButton({ apiPath, key, iconOn, iconOff, labelOn, labelOff, titleOn, titleOff, warnWhenOn }) {
      const { value, ready, set } = useSwitch(apiPath, key, key !== 'locked');
      const [busy, setBusy] = React.useState(false);
      const [note, setNote] = React.useState('');

      const onClick = async () => {
        if (busy || !ready) return;
        setBusy(true);
        setNote('');
        try {
          const next = !value;
          await set(next);
          setNote(next ? '已开启' : '已关闭');
          setTimeout(() => setNote(''), 3000);
        } catch (e) {
          setNote('切换失败：' + ((e && e.message) || String(e)));
          setTimeout(() => setNote(''), 5000);
        } finally {
          setBusy(false);
        }
      };

      const icon = !ready ? '⏳' : value ? iconOn : iconOff;
      const label = !ready ? '未就绪' : value ? labelOn : labelOff;
      const title = !ready ? '本会话尚未建立，稍后再试' : value ? titleOn : titleOff;
      const warn = ready && warnWhenOn ? value : false;

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
            style: Object.assign(
              {},
              baseBtn,
              busy || !ready ? { opacity: 0.55 } : null,
              warn ? { borderColor: 'rgba(255,138,0,0.6)' } : null,
            ),
          },
          h('span', { style: { fontSize: 14 } }, icon),
          h('span', { style: { fontSize: 12, opacity: 0.85 } }, label),
        ),
        note ? h('span', { style: { fontSize: 12, opacity: 0.75, whiteSpace: 'nowrap' } }, note) : null,
      );
    }

    function DevModeSwitch() {
      return h(
        'div',
        { style: { display: 'inline-flex', alignItems: 'center', gap: 8 } },
        h(SwitchButton, {
          apiPath: '/dsh-session-lock',
          key: 'locked',
          iconOn: '🔒',
          iconOff: '🔓',
          labelOn: '禁止读其它会话',
          labelOff: '允许读其它会话',
          titleOn: '当前会话已锁定：不会读取其它会话的内容。点击允许。',
          titleOff: '当前会话已允许：可以读取其它会话。点击锁定。',
          warnWhenOn: false,
        }),
        h(SwitchButton, {
          apiPath: '/dsh-quiet-run',
          key: 'quiet',
          iconOn: '🔇',
          iconOff: '🔊',
          labelOn: '静默运行',
          labelOff: '可见运行',
          titleOn: '静默运行：启动游戏或编辑器时会挪到屏幕外，不挡你、不抢焦点。点击改为可见。',
          titleOff: '可见运行：允许窗口出现在前台。点击改回静默。',
          warnWhenOn: false,
        }),
      );
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
      },
    };
  },
});