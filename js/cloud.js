/* 云端存储 + 登录门禁（Supabase）
   设计原则：
   1. 没登录 → 只显示登录页，业务界面整块藏起来，数据一条都不会下发给浏览器；
   2. 登录 → 从云端拉一份数据进内存，之后所有读写照旧（S.load / S.save 同步调用），
      改动在 600ms 后自动推回云端；
   3. 没配云端、或依赖库没加载成功 → C.enabled = false，整个系统行为与以前一模一样。
   数据表结构见仓库里的 supabase.sql（一行一个用户，payload 存整库 JSON）。 */
(function (A) {
  'use strict';
  const C = A.cloud = {};
  const cfg = window.CLOUD_CONFIG || {};
  const TABLE = cfg.table || 'app_data';
  const hasSdk = !!(window.supabase && window.supabase.createClient);

  C.enabled = !!(cfg.enabled && cfg.url && cfg.key && hasSdk);
  C.missingSdk = !!(cfg.enabled && cfg.url && cfg.key && !hasSdk);

  let sb = null;
  let session = null;
  let timer = null;
  let applying = false;     // 正在写入“从云端拉下来的数据”时不回声推送
  let bar = null;

  /* ---------------- 初始化 ---------------- */
  C.init = function () {
    if (!C.enabled || sb) return;
    sb = window.supabase.createClient(cfg.url, cfg.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
  };

  const uid = () => (session && session.user && session.user.id) || null;

  function friendly(err) {
    const m = (err && err.message) || String(err || '');
    if (/Invalid login credentials/i.test(m)) return '邮箱或密码不对';
    if (/Email not confirmed/i.test(m)) return '邮箱还没验证。请到 Supabase 后台把邮箱验证关掉，或点注册邮件里的链接';
    if (/already registered|already been registered/i.test(m)) return '这个邮箱已经注册过了，直接登录就行';
    if (/at least 6 characters/i.test(m)) return '密码至少 6 位';
    if (/Invalid email/i.test(m)) return '邮箱格式不对';
    if (/relation .*app_data.* does not exist|does not exist/i.test(m)) return '云端的表还没建好，请先在 Supabase 执行建表语句';
    if (/row-level security/i.test(m)) return '权限策略没配好，请检查 supabase.sql 是否全部执行';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return '连不上云端，请检查网络';
    return m || '出错了';
  }

  /* ---------------- 顶栏状态 ---------------- */
  C.mountBar = function () {
    const right = document.querySelector('.topbar-right');
    if (!right || bar || !C.enabled) return;
    bar = document.createElement('span');
    bar.className = 'cloud-bar';
    bar.title = '云端账号：' + ((session && session.user && session.user.email) || '');
    bar.innerHTML = '<i class="dot"></i><span class="who">已连接云端</span>' +
      '<button class="btn ghost sm" id="btnSignOut" type="button">退出</button>';
    right.insertBefore(bar, right.firstChild);
    bar.querySelector('#btnSignOut').addEventListener('click', C.signOut);
  };

  C.status = function (text, kind) {
    if (!bar) return;
    bar.className = 'cloud-bar' + (kind ? ' ' + kind : '');
    bar.querySelector('.who').textContent = text;
  };

  /* ---------------- 登录门禁 ---------------- */
  function showGate(resolve) {
    document.body.classList.add('gated');
    const gate = document.createElement('div');
    gate.className = 'gate';
    gate.innerHTML =
      '<div class="gate-card">' +
        '<div class="gate-brand"><span class="logo">IT</span>机房课堂管理</div>' +
        '<p class="gate-tip">请用老师的账号登录。数据存在云端，换设备登录同一个账号就能看到。</p>' +
        '<label class="gate-label">邮箱<input type="email" id="gateEmail" autocomplete="username" placeholder="you@example.com"></label>' +
        '<label class="gate-label">密码<input type="password" id="gatePwd" autocomplete="current-password" placeholder="至少 6 位"></label>' +
        '<div class="gate-msg" id="gateMsg"></div>' +
        '<div class="gate-actions">' +
          '<button class="btn primary" id="gateLogin" type="button">登录</button>' +
          '<button class="btn ghost" id="gateReg" type="button">注册新账号</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(gate);

    const msgEl = gate.querySelector('#gateMsg');
    const msg = (t, kind) => { msgEl.textContent = t; msgEl.className = 'gate-msg' + (kind ? ' ' + kind : ''); };
    const emailEl = gate.querySelector('#gateEmail');
    const pwdEl = gate.querySelector('#gatePwd');

    function pass() {
      gate.remove();
      document.body.classList.remove('gated');
      resolve(true);
    }

    async function doLogin() {
      const email = emailEl.value.trim();
      const pwd = pwdEl.value;
      if (!email || !pwd) { msg('邮箱和密码都要填', 'err'); return; }
      msg('登录中…');
      const { data, error } = await sb.auth.signInWithPassword({ email: email, password: pwd });
      if (error) { msg(friendly(error), 'err'); return; }
      session = data.session;
      pass();
    }

    async function doReg() {
      const email = emailEl.value.trim();
      const pwd = pwdEl.value;
      if (!email || !pwd) { msg('邮箱和密码都要填', 'err'); return; }
      if (pwd.length < 6) { msg('密码至少 6 位', 'err'); return; }
      msg('正在注册…');
      const { data, error } = await sb.auth.signUp({ email: email, password: pwd });
      if (error) { msg(friendly(error), 'err'); return; }
      if (data.session) { session = data.session; pass(); return; }
      msg('注册成功。项目还开着“邮箱验证”，请先去邮箱点验证链接，或到 Supabase 后台关掉邮箱验证再登录。', 'ok');
    }

    gate.querySelector('#gateLogin').addEventListener('click', doLogin);
    gate.querySelector('#gateReg').addEventListener('click', doReg);
    pwdEl.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    emailEl.addEventListener('keydown', e => { if (e.key === 'Enter') pwdEl.focus(); });
    setTimeout(() => emailEl.focus(), 30);
  }

  /** 返回 Promise<boolean>：true = 已登录可以进系统；false = 不进（不会有人拿到 false，除非以后加取消） */
  C.ensureLogin = function () {
    if (!C.enabled) return Promise.resolve(true);
    C.init();
    return new Promise(resolve => {
      sb.auth.getSession()
        .then(({ data }) => {
          if (data && data.session) { session = data.session; resolve(true); return; }
          showGate(resolve);
        })
        .catch(() => showGate(resolve));
    });
  };

  C.signOut = async function () {
    if (sb) { try { await sb.auth.signOut(); } catch (e) {} }
    session = null;
    location.reload();
  };

  /* ---------------- 拉取 / 推送 ---------------- */
  /** 登录后调用：云端有数据就用云端的；云端是空的而本机有数据，就把本机数据推上去（首次迁移） */
  C.pull = async function () {
    if (!C.enabled || !uid()) return { ok: false };
    const S = A.store;
    let data = null, error = null;
    try {
      const res = await sb.from(TABLE).select('payload, updated_at').eq('user_id', uid()).maybeSingle();
      data = res.data; error = res.error;
    } catch (e) { error = e; }
    if (error) throw new Error(friendly(error));

    const ok = data && data.payload && Array.isArray(data.payload.classes) && data.payload.classes.length;
    if (ok) {
      applying = true;
      S.applyRemote(data.payload);
      applying = false;
      C.status('已同步');
      return { ok: true, source: 'cloud' };
    }
    // 云端还没有数据。只有“这台设备以前真的存过数据”才把本机数据推上去，
    // 否则一台全新设备（手机）登录就会把一份空数据顶到云端，反过来把电脑上的真实数据覆盖掉。
    if (S.hasLocalData && S.hasLocalData()) {
      pushNow();
      return { ok: true, source: 'local' };
    }
    C.status('云端为空', 'bad');
    return { ok: true, source: 'empty' };
  };

  function pushNow() {
    if (!C.enabled || !uid() || applying) return;
    // 注意：pull() 在 boot 里先于 S.load() 执行，这里必须自己确保数据已在内存里
    const payload = A.store.raw() || A.store.load();
    if (!payload) return;
    C.status('同步中…');
    sb.from(TABLE).upsert(
      { user_id: uid(), payload: payload, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    ).then(({ error }) => {
      if (error) {
        C.status('未同步', 'bad');
        console.warn('[cloud] push failed:', error.message);
      } else {
        C.status('已同步');
      }
    });
  }

  /** S.save() 每次保存都会调这里，去抖后统一推送一次 */
  C.touch = function () {
    if (!C.enabled || applying) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; pushNow(); }, 600);
  };

  // 关页面前把没推完的补一次
  window.addEventListener('pagehide', () => {
    if (timer) { clearTimeout(timer); timer = null; pushNow(); }
  });

})(window.App);
