<script setup lang="ts">
import { computed } from 'vue'
import { splitContentWithMentions } from '@/utils/guestbookMentions'
import GuestbookMentionChip from '@/components/home/GuestbookMentionChip.vue'

const props = defineProps<{
  content: string
}>()

const emit = defineEmits<{
  openUser: [userId: number]
}>()

const segments = computed(() => splitContentWithMentions(props.content))
</script>

<template>
  <span class="gb-mention-text">
    <template v-for="(seg, idx) in segments" :key="idx">
      <template v-if="seg.type === 'text'">{{ seg.value }}</template>
      <GuestbookMentionChip
        v-else
        :user-id="seg.userId"
        :nickname="seg.name"
        @open-user="emit('openUser', $event)"
      />
    </template>
  </span>
</template>

<style scoped>
.gb-mention-text {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
