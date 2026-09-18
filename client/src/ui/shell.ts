export const APP_SHELL = `
<div class="app-shell">
  <section id="menu-screen" class="menu-screen">
    <header class="menu-header"><a class="brand" href="#" aria-label="猫猫夺店计划首页"><span class="brand-paw">✿</span><span>猫猫夺店计划<small>OPERATION: SNACK SHOP</small></span></a><div class="header-end"><span class="connection" id="connection">连接小街中</span><button class="text-button" data-do="help">玩法指南 ↗</button></div></header>
    <main class="menu-layout">
      <div class="hero">
        <span class="eyebrow"><i></i> 今晚 00:00 · 店长已离开</span>
        <h1>嘘，店长不在。<br>今晚<span>罐头归猫！</span></h1>
        <p class="hero-description">溜进小街，挑一家猫店安家。<br>占罐头窝、搭小机关，在天亮前准备好你的秘密基地。</p>
        <div class="hero-stamps"><span>☾ 30 秒夜间准备</span><span>⌗ 每局随机街区</span><span>✦ 六猫一起守店</span></div>
        <div class="poster" aria-label="三只小猫藏在罐头箱后面的插画">
          <div class="poster-moon">☾</div><span class="poster-star star-one">✦</span><span class="poster-star star-two">✧</span>
          <div class="poster-sign">店长外出 · 猫猫营业</div>
          <div class="poster-cat cat-two"><b></b><i></i><em>ω</em></div><div class="poster-cat cat-three"><b></b><i></i><em>ω</em></div><div class="poster-cat cat-one"><b></b><i></i><em>ω</em></div>
          <div class="poster-box"><span>FRESH CANS</span><strong>罐头秘密基地</strong><small>请勿打扰，正在赚罐头。</small><div class="can-stack">🥫 🥫 🥫</div></div>
          <span class="poster-sticker">NIGHT<br>SHIFT</span>
        </div>
      </div>
      <div class="menu-card">
        <div class="eyebrow">LET'S MAKE A LITTLE TROUBLE</div><h2>怎么出发？</h2><p class="muted">选好队伍，去街上找一家属于你的猫店。</p>
        <div class="mode-options">
          <button class="mode active" data-do="mode" data-capacity="1" aria-pressed="true"><span class="mode-icon">🐈</span><span><strong>单人模式</strong><small>你 + 5 位 AI 猫猫队友</small></span><b>✓</b></button>
          <button class="mode" data-do="mode" data-capacity="6" aria-pressed="false"><span class="mode-icon">🐾</span><span><strong>多人联机</strong><small>邀请 1–5 位好友，其余自动补齐 AI</small></span><b>↗</b></button>
        </div>
        <div class="map-picker"><h3>今晚去哪条街？</h3><div id="menu-map-picker"><p class="muted">正在寻找街区…</p></div></div>
        <section class="character-picker"><h3>今晚，你是哪只猫？</h3><p class="muted">六种毛色，同样爱吃罐头。</p><div id="menu-character-picker"></div></section>
        <label class="input-label" for="nickname">你的猫叫什么？</label><input id="nickname" maxlength="16" value="橘子" autocomplete="off" />
        <button id="create" class="primary wide" data-do="create">独自出发 <span>↗</span></button>
        <form id="join-form" class="join-form hidden"><label class="input-label" for="invite-input">已有好友房间？输入邀请码</label><div class="input-row"><input id="invite-input" aria-label="好友邀请码" maxlength="6" placeholder="6 位邀请码" autocomplete="off" /><button class="secondary" type="submit">加入好友</button></div></form>
        <div class="menu-note"><span>✧</span> 房间形状、位置和开局物资每局都不同。</div>
      </div>
    </main>
    <footer class="menu-footer"><span>SIX CATS. ONE STREET. ALL THE CANS.</span><span>猫猫夺店计划 · 玩法原型 0.3</span></footer>
  </section>
  <section id="lobby-screen" class="lobby-screen hidden"><div class="lobby-card" id="lobby-content"></div></section>
  <section id="game-screen" class="game-screen hidden">
    <header class="game-hud"><div class="hud-left"><button class="icon-button" data-do="leave" title="返回主菜单" aria-label="返回主菜单">↶</button><div class="game-title">猫猫夺店计划<small id="room-name">午夜猫街</small></div></div><div class="phase-group"><span id="phase-label">☾ 夜间准备</span><strong id="timer">00:30</strong><small id="phase-description">店长不在，找猫窝安家</small></div><div class="wallet" id="wallet" aria-label="局内货币"></div></header>
    <section class="battle-overview" aria-label="全员战况"><div id="combat-status"></div></section>
    <div class="map-stage" id="map-stage">
      <canvas id="board" aria-label="随机网格猫街地图，点击街道移动，点击罐头窝安家，点击自家格子安装道具"></canvas>
      <div id="cat-status" class="cat-status"></div>
      <div class="map-tools"><button data-do="zoom-in" aria-label="放大地图">＋</button><button data-do="zoom-out" aria-label="缩小地图">−</button><button data-do="fit" aria-label="街区总览" title="缩小到最远视野 · 拖动查看街区">⌗</button><button id="camera-follow" data-do="locate" aria-label="定位并跟随我的猫" aria-pressed="true" title="镜头正在跟随你的猫 · 拖动可自由查看">◎</button></div>
      <div class="map-legend"><span><i class="dot me"></i>你的猫</span><span><i class="dot nest"></i>罐头窝</span><span><i class="dot enemy"></i>店长</span></div>
      <div id="grid-menu" class="grid-menu hidden" role="dialog" aria-label="格子操作菜单"></div>
      <div id="result" class="result-overlay hidden"></div>
    </div>
    <footer class="game-footer"><span id="game-tip">点击街道移动 · 点击罐头窝安家 · 点击自家网格安装道具</span><span id="notice"></span><button data-do="help" class="text-button">?</button></footer>
  </section>
  <div id="manager-announcement" class="manager-announcement hidden" role="status" aria-live="polite" aria-atomic="true"></div>
  <div id="loading" class="loading-overlay hidden" role="status"><div class="loading-paw">🐾</div><h2>小猫正在溜进街区…</h2><p>打开随机猫店，清点今晚的罐头。</p><div class="loading-track"><i></i></div></div>
  <div id="offline" class="offline hidden">连接中断，正在重新连接；离线 5 秒后 AI 会暂时照顾你的猫。</div>
  <div id="modal" class="modal-backdrop hidden"></div><div id="toast" class="toast hidden" role="status"></div>
</div>`;
