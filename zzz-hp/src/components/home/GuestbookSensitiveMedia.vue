<script setup lang="ts">
import { computed, inject } from 'vue'
import { GUESTBOOK_SENSITIVE_REVEAL_KEY } from '@/composables/useGuestbookSensitiveReveal'

const props = defineProps<{
  postId: number
  isSensitive?: boolean
  src: string
  alt?: string
  imgClass?: string | string[] | Record<string, boolean>
  loading?: 'lazy' | 'eager'
}>()

const revealApi = inject(GUESTBOOK_SENSITIVE_REVEAL_KEY)

const blurred = computed(
  () => revealApi?.shouldBlurPost(props.postId, props.isSensitive) ?? false,
)

function onReveal() {
  revealApi?.revealPost(props.postId)
}
</script>

<template>
  <div class="gb-sensitive-media" :class="{ 'is-blurred': blurred }">
    <img
      :class="[imgClass, { 'gb-sensitive-media__img--blurred': blurred }]"
      :src="src"
      :alt="alt || ''"
      :loading="loading"
    />
    <button v-if="blurred" type="button" class="gb-sensitive-media__mask" @click.stop="onReveal">
      敏感内容，点击查看
    </button>
  </div>
</template>

<style scoped>
.gb-sensitive-media {
  position: relative;
  /* 建立独立层叠上下文，防止遮罩越级覆盖卡片头像等外部元素 */
  z-index: 0;
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.gb-sensitive-media img {
  display: block;
  width: 100%;
  height: 100%;
}

.gb-sensitive-media__img--blurred {
  filter: blur(12px);
  transform: scale(1.05);
}

.gb-sensitive-media__mask {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem;
  border: none;
  background: rgb(8 10 14 / 55%);
  color: #f2d0a9;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1.35;
  text-align: center;
  cursor: pointer;
  transition: background 0.15s ease;
}

.gb-sensitive-media__mask:hover {
  background: rgb(8 10 14 / 68%);
}
</style>
