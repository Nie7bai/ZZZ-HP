<script setup lang="ts">
import { computed } from 'vue'
import GuestbookMentionText from '@/components/home/GuestbookMentionText.vue'
import { splitQuotedContent, type GuestbookQuoteRef } from '@/utils/guestbookQuotes'

const props = defineProps<{
  content: string
  isMine?: boolean
  inBubble?: boolean
}>()

const emit = defineEmits<{
  openUser: [userId: number]
  jumpQuote: [quote: GuestbookQuoteRef]
}>()

const parsed = computed(() => splitQuotedContent(props.content))

function onQuoteClick() {
  if (parsed.value.quote) emit('jumpQuote', parsed.value.quote)
}
</script>

<template>
  <span
    class="gb-rich-text"
    :class="{
      'is-mine': isMine,
      'is-bubble': inBubble,
      'is-bubble-mine': inBubble && isMine,
    }"
  >
    <button
      v-if="parsed.quote"
      type="button"
      class="gb-quote-block"
      @click="onQuoteClick"
    >
      <span class="gb-quote-block__label">引用 {{ parsed.quote.nickname }}</span>
      <span class="gb-quote-block__text">{{ parsed.quote.preview || '…' }}</span>
    </button>
    <GuestbookMentionText
      v-if="parsed.body"
      :content="parsed.body"
      @open-user="emit('openUser', $event)"
    />
  </span>
</template>

<style scoped>
.gb-rich-text {
  display: block;
  white-space: pre-wrap;
  word-break: break-word;
}

.gb-quote-block {
  display: block;
  width: 100%;
  margin: 0 0 10px;
  padding: 8px 10px;
  border: 0;
  border-left: 3px solid #9dcc00;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease;
}

.gb-quote-block:hover {
  background: rgba(255, 255, 255, 0.12);
}

.gb-quote-block__label {
  display: block;
  margin-bottom: 4px;
  color: #9dcc00;
  font-size: 12px;
  font-weight: 700;
}

.gb-quote-block__text {
  display: block;
  color: rgba(255, 255, 255, 0.72);
  font-size: 13px;
  line-height: 1.45;
}

/* 聊天气泡内：白底消息 */
.gb-rich-text.is-bubble:not(.is-bubble-mine) .gb-quote-block {
  border-left: 3px solid #9dcc00;
  background: #ececec;
}

.gb-rich-text.is-bubble:not(.is-bubble-mine) .gb-quote-block:hover {
  background: #e2e2e2;
}

.gb-rich-text.is-bubble:not(.is-bubble-mine) .gb-quote-block__label {
  color: #6a8f00;
}

.gb-rich-text.is-bubble:not(.is-bubble-mine) .gb-quote-block__text {
  color: #444;
}

/* 聊天气泡内：自己的蓝底消息 */
.gb-rich-text.is-bubble-mine .gb-quote-block {
  border-left: 3px solid #d8ff4d;
  border-right: none;
  background: rgba(0, 0, 0, 0.2);
  text-align: left;
}

.gb-rich-text.is-bubble-mine .gb-quote-block:hover {
  background: rgba(0, 0, 0, 0.28);
}

.gb-rich-text.is-bubble-mine .gb-quote-block__label {
  color: #d8ff4d;
}

.gb-rich-text.is-bubble-mine .gb-quote-block__text {
  color: rgba(255, 255, 255, 0.9);
}
</style>
