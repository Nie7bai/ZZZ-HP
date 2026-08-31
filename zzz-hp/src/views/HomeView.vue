<script setup lang="ts">
import HomeChangelog from '@/components/home/HomeChangelog.vue'

interface ModeCard {
  title: string
  en: string
  num: string
  path: string
  desc: string
  span: number
  icon: string
}

const modes: ModeCard[] = [
  {
    title: '危局强袭战',
    en: 'CRISIS ASSAULT',
    num: '01',
    path: '/crisis-assault',
    desc: '往期血量 · 分数反推 · 期数与怪物对比',
    span: 7,
    icon: 'M12 3 L22 21 H2 Z M12 10 v5 M12 18.5 v0.5',
  },
  {
    title: '式舆防卫战',
    en: 'SHIYU DEFENSE',
    num: '02',
    path: '/defense',
    desc: '新旧防卫数据 · 防线房间一览',
    span: 5,
    icon: 'M12 3 L20 6 v6 c0 5 -3.5 8 -8 9 c-4.5 -1 -8 -4 -8 -9 V6 Z',
  },
  {
    title: '临界推演',
    en: 'CRITICAL DEDUCTION',
    num: '03',
    path: '/deduction',
    desc: '推演模式数据浏览',
    span: 5,
    icon: 'M12 2 L22 12 L12 22 L2 12 Z M12 7 L17 12 L12 17 L7 12 Z',
  },
  {
    title: '角色计算器',
    en: 'DAMAGE CALC',
    num: '04',
    path: '/character-calculator',
    desc: '面板 / 词条 / 最优分配 · 伤害乘区计算',
    span: 7,
    icon: 'M5 4 h14 v16 H5 Z M5 9 h14 M9 9 v11',
  },
  {
    title: '网站说明',
    en: 'SITE INFO',
    num: '05',
    path: '/about',
    desc: '关于本站 · 网站内容 · 借鉴与参考 · 版权声明',
    span: 12,
    icon: 'M12 3 a9 9 0 1 0 0.01 0 Z M12 11 v6 M12 7.5 v0.5',
  },
]
</script>

<template>
  <main class="home zzz-anim zzz-cursor-zone">
    <!-- 背景：拼贴画（zenless.tools 式丰富低对比） + 骑士布配菜 -->
    <div class="home-bg" aria-hidden="true" />

    <div class="home-inner">
      <!-- Hero：一个黄色色块，一句大字 -->
      <header class="hero">
        <span class="hero-tag">非官方 · 玩家自制工具站</span>
        <h1 class="hero-title zzz-display">
          <span class="hero-title-en">ZZZ-HP</span>
        </h1>
        <p class="hero-cn">
          <span>绝区零 · 数据查询与伤害计算站</span>
          <img class="hero-knightboo" src="/zzz-assets/Bangboo.gif" alt="邦布" />
        </p>
      </header>

      <!-- 模式入口：深色卡片 + 单色纪律 -->
      <section class="cards" aria-label="功能入口">
        <RouterLink
          v-for="mode in modes"
          :key="mode.path"
          :to="mode.path"
          class="card"
          :class="`card--span-${mode.span}`"
        >
          <span class="card-num zzz-display" aria-hidden="true">{{ mode.num }}</span>
          <span class="card-body">
            <span class="card-title">{{ mode.title }}</span>
            <span class="card-en">{{ mode.en }}</span>
            <span class="card-desc">{{ mode.desc }}</span>
          </span>
          <svg
            class="card-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path :d="mode.icon" />
          </svg>
        </RouterLink>
      </section>

      <!-- 更新日志 -->
      <section class="changelog-deck" aria-label="更新日志">
        <div class="deck-body">
          <HomeChangelog />
        </div>
      </section>
    </div>

    <RouterLink to="/admin/login" class="admin-entry">ADMIN</RouterLink>
  </main>
</template>

<style scoped>
.home {
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--zzz-bg);
  color: var(--zzz-fg);
}

/* ── 背景：拼贴画 + 极慢漂浮 ─────────────── */
.home-bg {
  position: fixed;
  inset: -6%;
  z-index: 0;
  pointer-events: none;
  background: url('/zzz-assets/bg-collage.webp') center / cover no-repeat;
  animation: bg-drift 14s ease-in-out infinite alternate;
  will-change: transform;
}

[data-theme='light'] .home-bg {
  filter: invert(0.94);
  opacity: 0.5;
}

@keyframes bg-drift {
  from {
    transform: translate3d(-1.6%, -0.8%, 0);
  }
  to {
    transform: translate3d(1.6%, 0.8%, 0);
  }
}

/* ── 布局 ─────────────────────────────────── */
.home-inner {
  position: relative;
  z-index: 1;
  width: min(1040px, 100%);
  margin: 0 auto;
  padding: clamp(3rem, 9vh, 6rem) 1.5rem 5rem;
  display: flex;
  flex-direction: column;
  gap: clamp(2rem, 5vh, 3.2rem);
}

/* ── Hero ─────────────────────────────────── */
.hero {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.9rem;
}

.hero-tag {
  font-family: var(--zzz-font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  color: var(--zzz-fg-dim);
}

.hero-title {
  margin: 0;
  line-height: 0.95;
}

.hero-title-en {
  display: inline-block;
  padding: 0.04em 0.14em 0.06em 0.06em;
  font-size: clamp(3.2rem, 9.5vw, 6.8rem);
  background: var(--zzz-yellow);
  color: #0a0a0a;
  transform: skew(-8deg);
}

.hero-cn {
  display: flex;
  align-items: flex-end;
  gap: 0.7rem;
  margin: 0;
  font-size: clamp(1.05rem, 2.4vw, 1.5rem);
  font-weight: 900;
  letter-spacing: 0.24em;
  color: var(--zzz-fg);
}

/* 邦布配菜：过场剪影款，小尺寸，GIF 自带跑动 */
.hero-knightboo {
  height: 1.9em;
  margin-bottom: -0.15em;
  pointer-events: none;
  user-select: none;
}

/* 浅色主题：白色剪影反转为黑色剪影（加载画面黑白对调） */
[data-theme='light'] .hero-knightboo {
  filter: brightness(0);
}

/* ── 模式卡片：单色纪律 ───────────────────── */
.cards {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 0.9rem;
}

.card--span-7 {
  grid-column: span 7;
}

.card--span-5 {
  grid-column: span 5;
}

.card--span-12 {
  grid-column: span 12;
}

.card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 1.1rem;
  min-height: 104px;
  padding: 1rem 1.25rem;
  background: var(--zzz-card);
  border: 2px solid var(--zzz-card-border);
  border-radius: var(--zzz-radius-card);
  color: var(--zzz-fg);
  text-decoration: none;
  transition:
    transform 0.16s ease-out,
    border-color 0.16s ease-out,
    background-color 0.16s ease-out;
}

.card-num {
  flex-shrink: 0;
  font-size: clamp(1.9rem, 3.2vw, 2.7rem);
  line-height: 1;
  color: var(--zzz-yellow);
  transition: color 0.16s ease-out;
}

/* 浅色主题：荧光黄压暗为橄榄黄保证对比度 */
[data-theme='light'] .card-num {
  color: #8a7d00;
}

.card-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.card-title {
  font-size: 1.22rem;
  font-weight: 900;
  letter-spacing: 0.06em;
}

.card-en {
  font-family: var(--zzz-font-mono);
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: var(--zzz-fg-dim);
}

.card-desc {
  font-size: 0.78rem;
  color: var(--zzz-fg-dim);
}

.card-icon {
  margin-left: auto;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  color: var(--zzz-fg-dim);
  transition:
    transform 0.16s ease-out,
    color 0.16s ease-out;
}

/* hover：整卡黄底黑字反转 */
.card:hover {
  transform: translateY(-2px);
  background: var(--zzz-yellow);
  border-color: var(--zzz-yellow);
  color: #0a0a0a;
}

.card:hover .card-num,
.card:hover .card-title,
.card:hover .card-en,
.card:hover .card-desc {
  color: #0a0a0a;
}

.card:hover .card-en,
.card:hover .card-desc {
  opacity: 0.72;
}

.card:hover .card-icon {
  transform: translateX(3px) scale(1.12);
  color: #0a0a0a;
}

/* ── 更新日志面板 ─────────────────────────── */
.changelog-deck {
  border: 2px solid var(--zzz-card-border);
  border-radius: var(--zzz-radius-card);
  background: var(--zzz-card);
  overflow: hidden;
}

.deck-body {
  padding: 0.2rem;
}

.deck-body :deep(.changelog) {
  width: 100%;
  border: none;
  border-radius: 0;
  background: transparent;
  padding: 0.7rem 0.8rem 0.8rem;
}

.deck-body :deep(.changelog-header h2) {
  font-family: var(--zzz-font-display);
  font-weight: 900;
  letter-spacing: 0.08em;
  color: var(--zzz-fg);
}

.deck-body :deep(.changelog-item) {
  border-color: var(--zzz-line);
  border-radius: 4px;
  background: rgba(127, 127, 127, 0.08);
}

.deck-body :deep(.changelog-summary:hover) {
  background: rgba(251, 254, 0, 0.08);
}

.deck-body :deep(.ver) {
  color: var(--zzz-yellow);
  font-family: var(--zzz-font-mono);
}

[data-theme='light'] .deck-body :deep(.ver) {
  color: #7a7a00;
}

.deck-body :deep(.sum-title) {
  color: var(--zzz-fg);
}

/* ── 管理员入口 ───────────────────────────── */
.admin-entry {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  z-index: 1100;
  padding: 0.5rem 0.9rem;
  background: var(--zzz-ink-1);
  border: 1px solid var(--zzz-line-strong);
  border-radius: var(--zzz-radius-btn);
  color: #f5f5f0;
  font-family: var(--zzz-font-mono);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-decoration: none;
  opacity: 0.75;
  transition:
    opacity 0.16s ease-out,
    background-color 0.16s ease-out,
    color 0.16s ease-out,
    border-color 0.16s ease-out;
}

[data-theme='light'] .admin-entry {
  background: #141412;
  color: #f5f5f0;
}

.admin-entry:hover {
  opacity: 1;
  background: var(--zzz-yellow);
  border-color: var(--zzz-yellow);
  color: #0a0a0a;
}

/* ── 入场动效：交错上浮，只播一次 ─────────── */
@keyframes rise-in {
  from {
    opacity: 0;
    transform: translateY(18px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.hero-tag,
.hero-title,
.hero-cn {
  animation: rise-in 0.42s cubic-bezier(0.165, 0.84, 0.44, 1) both;
}

.hero-title {
  animation-delay: 0.06s;
}

.hero-cn {
  animation-delay: 0.12s;
}

.card {
  animation: rise-in 0.38s cubic-bezier(0.165, 0.84, 0.44, 1) both;
}

.card:nth-of-type(1) {
  animation-delay: 0.18s;
}

.card:nth-of-type(2) {
  animation-delay: 0.24s;
}

.card:nth-of-type(3) {
  animation-delay: 0.3s;
}

.card:nth-of-type(4) {
  animation-delay: 0.36s;
}

.card:nth-of-type(5) {
  animation-delay: 0.42s;
}

.changelog-deck {
  animation: rise-in 0.42s cubic-bezier(0.165, 0.84, 0.44, 1) 0.5s both;
}

/* ── 移动端 ───────────────────────────────── */
@media (max-width: 900px) {
  .card--span-7,
  .card--span-5 {
    grid-column: span 12;
  }
}

@media (max-width: 560px) {
  .home-inner {
    padding: 2rem 0.9rem 4.5rem;
    gap: 1.5rem;
  }

  .card {
    min-height: 92px;
    padding: 0.9rem 1rem;
  }

  .card-desc {
    display: none;
  }

  .hero-cn {
    letter-spacing: 0.14em;
  }
}
</style>
