<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { fetchGuestbookUserProfile } from '@/api/guestbook'
import { resolveAssetUrl } from '@/utils/gameData'
import { cacheMentionAvatar, getMentionAvatar } from '@/utils/guestbookMentions'

const props = defineProps<{
  userId: number
  nickname: string
  avatar?: string
}>()

const emit = defineEmits<{
  openUser: [userId: number]
}>()

const avatar = ref(props.avatar || '')

const avatarSrc = computed(() => resolveAssetUrl(avatar.value) || '')
const letter = computed(() => (props.nickname || '匿').trim().charAt(0).toUpperCase())

onMounted(async () => {
  if (props.avatar) {
    cacheMentionAvatar(props.userId, props.avatar)
    avatar.value = props.avatar
    return
  }
  const cached = getMentionAvatar(props.userId)
  if (cached) {
    avatar.value = cached
    return
  }
  try {
    const profile = await fetchGuestbookUserProfile(props.userId)
    if (profile.avatar) {
      cacheMentionAvatar(props.userId, profile.avatar)
      avatar.value = profile.avatar
    }
  } catch {
    /* ignore */
  }
})
</script>

<template>
  <button type="button" class="gb-mention-chip" @click.stop="emit('openUser', userId)">
    <span class="gb-mention-chip__avatar">
      <img v-if="avatarSrc" :src="avatarSrc" alt="" />
      <span v-else>{{ letter }}</span>
    </span>
    <span class="gb-mention-chip__meta">
      <span class="gb-mention-chip__name">@{{ nickname }}</span>
      <span class="gb-mention-chip__id">UID {{ userId }}</span>
    </span>
  </button>
</template>

<style scoped>
.gb-mention-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0 2px;
  padding: 2px 8px 2px 2px;
  border: 1px solid rgba(191, 255, 9, 0.35);
  border-radius: 999px;
  background: rgba(191, 255, 9, 0.08);
  color: #bfff09;
  font: inherit;
  cursor: pointer;
  vertical-align: middle;
}

.gb-mention-chip__avatar {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  overflow: hidden;
  flex-shrink: 0;
  border: 1px solid #000;
  background: #333;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 900;
  color: #fff;
}

.gb-mention-chip__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.gb-mention-chip__meta {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.gb-mention-chip__name {
  font-weight: 800;
  white-space: nowrap;
}

.gb-mention-chip__id {
  font-size: 11px;
  color: rgba(191, 255, 9, 0.72);
  white-space: nowrap;
}
</style>
