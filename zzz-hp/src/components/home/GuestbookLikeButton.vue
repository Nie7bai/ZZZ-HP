<script setup lang="ts">
defineProps<{
  active?: boolean
  count?: number
  compact?: boolean
  tip?: string
}>()
</script>

<template>
  <span
    class="gb-like-btn"
    :class="{ 'is-active': active, 'is-compact': compact, 'has-count': (count ?? 0) > 0 }"
  >
    <svg class="gb-like-btn__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14.5 9.2V5.8c0-1.2-.9-2.2-2.1-2.2-.6 0-1.1.3-1.5.7L7.8 8.5c-.3.4-.5.9-.5 1.4v8.3c0 .9.7 1.6 1.6 1.6h7.1c.7 0 1.3-.5 1.5-1.1l1.8-5.4c.3-1-.4-2.1-1.5-2.1h-3.3z"
        :fill="active ? 'currentColor' : 'none'"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
      <path
        d="M4.8 9.9h2.2v9.9H5.5c-.9 0-1.6-.7-1.6-1.6v-6.7c0-.9.7-1.6 1.6-1.6h-.7z"
        :fill="active ? 'currentColor' : 'none'"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
    </svg>
    <template v-if="(count ?? 0) > 0">
      <span class="gb-like-btn__sep" aria-hidden="true" />
      <span class="gb-like-btn__count">{{ count }}</span>
    </template>
  </span>
</template>

<style scoped>
.gb-like-btn {
  display: inline-flex;
  align-items: center;
  gap: 0;
  color: rgba(255, 255, 255, 0.5);
  line-height: 1;
}

.gb-like-btn.is-active {
  color: #fbfe00;
}

.gb-like-btn__icon {
  width: 17px;
  height: 17px;
  display: block;
  flex-shrink: 0;
}

.gb-like-btn.is-compact .gb-like-btn__icon {
  width: 15px;
  height: 15px;
}

.gb-like-btn__sep {
  width: 1px;
  height: 11px;
  margin: 0 6px;
  background: rgba(255, 255, 255, 0.22);
  flex-shrink: 0;
}

.gb-like-btn.is-active .gb-like-btn__sep {
  background: rgba(251, 254, 0, 0.35);
}

.gb-like-btn__count {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
  color: inherit;
}
</style>
