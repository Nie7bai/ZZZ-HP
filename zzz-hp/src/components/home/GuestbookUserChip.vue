<script setup lang="ts">
import { computed } from 'vue'
import { resolveAssetUrl } from '@/utils/gameData'
import { expBarLabel, expBarPercent, mapExpProgress } from '@/utils/guestbookLevel'

const props = defineProps<{
  nickname: string
  avatar?: string
  level?: number
  exp?: number
  isBanned?: boolean
}>()

const emit = defineEmits<{
  openBan: []
}>()

const progress = computed(() => mapExpProgress(props.level, props.exp))
const barPercent = computed(() => expBarPercent(progress.value))
const barLabel = computed(() => expBarLabel(progress.value))

function avatarLetter(name: string) {
  return (name || '旅').trim().charAt(0).toUpperCase()
}

function avatarTone(name: string) {
  let hash = 0
  for (const ch of name || '旅') hash = (hash * 33 + ch.charCodeAt(0)) >>> 0
  return 20 + (hash % 320)
}
</script>

<template>
  <div class="gb-user-chip">
    <span
      v-if="avatar"
      class="gb-user-chip__avatar gb-user-chip__avatar--img"
    >
      <img :src="resolveAssetUrl(avatar) || ''" alt="" />
    </span>
    <span
      v-else
      class="gb-user-chip__avatar"
      :style="{ '--tone': String(avatarTone(nickname)) }"
    >
      {{ avatarLetter(nickname) }}
    </span>
    <span class="gb-user-chip__main">
      <strong class="gb-user-chip__name">{{ nickname }}</strong>
      <span class="gb-user-chip__bar" :class="{ 'is-max': progress.isMaxLevel }">
        <span class="gb-user-chip__bar-fill" :style="{ width: `${barPercent}%` }" />
        <span class="gb-user-chip__bar-text">{{ barLabel }}</span>
      </span>
    </span>
    <span class="gb-user-chip__level">
      <strong>{{ progress.level }}</strong>
      <small>LEVEL</small>
    </span>
    <button
      v-if="isBanned"
      type="button"
      class="gb-user-chip__ban"
      @click.stop="emit('openBan')"
    >
      封禁状态
    </button>
  </div>
</template>

<style scoped>
.gb-user-chip {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-width: 280px;
  width: 100%;
  max-width: min(500px, 68vw);
  padding: 0.38rem 0.75rem 0.38rem 0.38rem;
  border: 1px solid #2a2a2a;
  border-radius: 999px;
  background: #121212;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

@media (max-width: 560px) {
  .gb-user-chip {
    min-width: 0;
    max-width: 100%;
    width: 100%;
    box-sizing: border-box;
  }
}

.gb-user-chip__avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.65rem;
  height: 2.65rem;
  border-radius: 999px;
  background: hsl(var(--tone, 200) 42% 34%);
  color: #fff;
  font-size: 0.95rem;
  font-weight: 800;
  flex-shrink: 0;
  overflow: hidden;
}

.gb-user-chip__avatar--img img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.gb-user-chip__main {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 0.28rem;
}

.gb-user-chip__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #fff;
  font-size: 0.9rem;
  font-weight: 700;
  line-height: 1.1;
}

.gb-user-chip__bar {
  position: relative;
  height: 1.15rem;
  border-radius: 999px;
  background: #1e1e1e;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}

.gb-user-chip__bar-fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: linear-gradient(90deg, #3d7cff, #6eb5ff);
}

.gb-user-chip__bar-text {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #fff;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.03em;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
}

.gb-user-chip__level {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 2.5rem;
  padding-right: 0.15rem;
  flex-shrink: 0;
  color: #fff;
  line-height: 1;
}

.gb-user-chip__level strong {
  font-size: 1.5rem;
  font-weight: 900;
}

.gb-user-chip__level small {
  margin-top: 0.15rem;
  color: rgba(255, 255, 255, 0.42);
  font-size: 0.52rem;
  font-weight: 800;
  letter-spacing: 0.1em;
}

.gb-user-chip__ban {
  flex-shrink: 0;
  border: 1px solid rgba(255, 90, 90, 0.55);
  border-radius: 999px;
  padding: 0.28rem 0.55rem;
  background: rgba(180, 40, 40, 0.28);
  color: #ffb4b4;
  font-size: 0.68rem;
  font-weight: 800;
  cursor: pointer;
}

.gb-user-chip__ban:hover {
  background: rgba(200, 50, 50, 0.42);
}
</style>
