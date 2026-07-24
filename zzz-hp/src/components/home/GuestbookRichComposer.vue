<script setup lang="ts">

import { onMounted, onUnmounted, ref } from 'vue'

import { GUESTBOOK_EMOJIS, insertAtCursor } from '@/utils/guestbookEmojis'

import {

  addCustomSticker,

  loadCustomStickers,

  MAX_CUSTOM_STICKERS,

  removeCustomSticker,

  type GuestbookCustomSticker,

} from '@/utils/guestbookCustomStickers'

import { uploadGuestbookImage } from '@/api/guestbook'

import { resolveAssetUrl } from '@/utils/gameData'

import GuestbookComposerIcons from '@/components/home/GuestbookComposerIcons.vue'
import GuestbookConfirmDialog from '@/components/home/GuestbookConfirmDialog.vue'



const props = withDefaults(

  defineProps<{

    modelValue: string

    images?: string[]

    placeholder?: string

    maxlength?: number

    rows?: number

    disabled?: boolean

    sending?: boolean

    maxImages?: number

    showSend?: boolean

    showMention?: boolean

    sendLabel?: string

  }>(),

  {

    images: () => [],

    placeholder: '输入内容…',

    maxlength: 2000,

    rows: 2,

    disabled: false,

    sending: false,

    maxImages: 3,

    showSend: true,

    showMention: true,

    sendLabel: '发送',

  },

)



const emit = defineEmits<{

  'update:modelValue': [value: string]

  'update:images': [value: string[]]

  send: []

  'caret-change': [caret: number]

  'sticker-saved': [url: string]

  'preview-image': [payload: { urls: string[]; index: number }]

}>()



const inputRef = ref<HTMLTextAreaElement | null>(null)

const emojiOpen = ref(false)

const stickerOpen = ref(false)

const stickers = ref<GuestbookCustomSticker[]>(loadCustomStickers())

const uploading = ref(false)

const stickerUploading = ref(false)

const uploadError = ref('')

const stickerHint = ref('')

let stickerHintTimer: ReturnType<typeof setTimeout> | null = null

const stickerDeleteTarget = ref<GuestbookCustomSticker | null>(null)



function showStickerHint(message: string) {

  stickerHint.value = message

  if (stickerHintTimer) clearTimeout(stickerHintTimer)

  stickerHintTimer = setTimeout(() => {

    stickerHint.value = ''

    stickerHintTimer = null

  }, 2000)

}



function onInput(event: Event) {

  const el = event.target as HTMLTextAreaElement

  emit('update:modelValue', el.value)

  emit('caret-change', el.selectionStart ?? el.value.length)

}



function closePanels() {

  emojiOpen.value = false

  stickerOpen.value = false

}



function toggleEmoji() {

  stickerOpen.value = false

  emojiOpen.value = !emojiOpen.value

}



function toggleSticker() {

  emojiOpen.value = false

  stickerOpen.value = !stickerOpen.value

  stickers.value = loadCustomStickers()

}



function pickEmoji(emoji: string) {

  const el = inputRef.value

  if (!el) {

    emit('update:modelValue', `${props.modelValue}${emoji}`)

  } else {

    insertAtCursor(el, emoji)

    emit('update:modelValue', el.value)

    emit('caret-change', el.selectionStart ?? el.value.length)

  }

  emojiOpen.value = false

}



function insertMentionTrigger() {

  const el = inputRef.value

  if (!el) {

    emit('update:modelValue', `${props.modelValue}@`)

    return

  }

  insertAtCursor(el, '@')

  emit('update:modelValue', el.value)

  emit('caret-change', el.selectionStart ?? el.value.length)

}



async function onPickImage(event: Event) {

  const input = event.target as HTMLInputElement

  const file = input.files?.[0]

  input.value = ''

  if (!file || props.images.length >= props.maxImages) return

  uploading.value = true

  uploadError.value = ''

  try {

    const uploaded = await uploadGuestbookImage(file)

    emit('update:images', [...props.images, uploaded.url])

  } catch (err) {

    uploadError.value = err instanceof Error ? err.message : '上传失败'

  } finally {

    uploading.value = false

  }

}



async function onPickStickerFile(event: Event) {

  const input = event.target as HTMLInputElement

  const file = input.files?.[0]

  input.value = ''

  if (!file) return

  stickerUploading.value = true

  try {

    const uploaded = await uploadGuestbookImage(file)

    stickers.value = addCustomSticker(uploaded.url)

    emit('sticker-saved', uploaded.url)

    showStickerHint('已添加收藏表情')

  } catch (err) {

    showStickerHint(err instanceof Error ? err.message : '添加失败')

  } finally {

    stickerUploading.value = false

  }

}



function pickSticker(url: string) {

  if (props.images.length >= props.maxImages) {

    showStickerHint(`最多添加 ${props.maxImages} 张图片`)

    return

  }

  if (props.images.includes(url)) {

    showStickerHint('已在待发送图片中')

    return

  }

  emit('update:images', [...props.images, url])
  stickerOpen.value = false
}



function requestRemoveSticker(item: GuestbookCustomSticker, event: Event) {
  event.stopPropagation()
  stickerDeleteTarget.value = item
}

function confirmRemoveSticker() {
  if (!stickerDeleteTarget.value) return
  stickers.value = removeCustomSticker(stickerDeleteTarget.value.id)
  stickerDeleteTarget.value = null
  showStickerHint('已删除收藏表情')
}



function removeSticker(id: string, event: Event) {

  event.stopPropagation()

  const item = stickers.value.find((entry) => entry.id === id)
  if (item) requestRemoveSticker(item, event)

}



function removeImage(index: number) {

  emit(

    'update:images',

    props.images.filter((_, i) => i !== index),

  )

}



function previewImage(index: number) {

  emit('preview-image', { urls: [...props.images], index })

}



function submit() {

  closePanels()

  emit('send')

}



function onDocumentClick(event: MouseEvent) {

  const target = event.target as HTMLElement | null

  if (!target?.closest('.gb-rich-composer__emoji-wrap, .gb-rich-composer__sticker-wrap')) {

    closePanels()

  }

}



onMounted(() => {

  document.addEventListener('click', onDocumentClick)

})



onUnmounted(() => {

  document.removeEventListener('click', onDocumentClick)

  if (stickerHintTimer) clearTimeout(stickerHintTimer)

})



defineExpose({

  refreshStickers() {

    stickers.value = loadCustomStickers()

  },

  saveStickerFromUrl(url: string) {

    const normalized = String(url || '').trim()

    if (!normalized) return false

    stickers.value = addCustomSticker(normalized)

    emit('sticker-saved', normalized)

    return true

  },

})

</script>



<template>

  <div class="gb-rich-composer">

    <div v-if="images.length" class="gb-rich-composer__images">

      <div

        v-for="(url, index) in images"

        :key="url + index"

        class="gb-rich-composer__thumb"

        @dblclick.prevent="previewImage(index)"

      >

        <img :src="resolveAssetUrl(url) || url" alt="" />

        <button type="button" aria-label="移除图片" @click.stop="removeImage(index)">×</button>

      </div>

    </div>

    <div class="gb-rich-composer__row">

      <textarea

        ref="inputRef"

        class="gb-rich-composer__input"

        :value="modelValue"

        :rows="rows"

        :maxlength="maxlength"

        :placeholder="placeholder"

        :disabled="disabled || sending"

        @input="onInput"

        @keydown.enter.exact.prevent="submit"

      />

      <div class="gb-rich-composer__tools">

        <label class="gb-rich-composer__tool gb-rich-composer__tool--file" title="图片">

          <GuestbookComposerIcons kind="image" />

          <input

            type="file"

            accept="image/*"

            :disabled="disabled || sending || uploading || images.length >= maxImages"

            @change="onPickImage"

          />

        </label>

        <button

          v-if="showMention"

          type="button"

          class="gb-rich-composer__tool"

          title="@ 提及"

          @click="insertMentionTrigger"

        >

          <GuestbookComposerIcons kind="mention" />

        </button>

        <div class="gb-rich-composer__emoji-wrap">

          <button type="button" class="gb-rich-composer__tool" title="表情" @click.stop="toggleEmoji">

            <GuestbookComposerIcons kind="emoji" />

          </button>

          <div v-if="emojiOpen" class="gb-rich-composer__emoji-panel" @click.stop>

            <button

              v-for="emoji in GUESTBOOK_EMOJIS"

              :key="emoji"

              type="button"

              class="gb-rich-composer__emoji"

              @click="pickEmoji(emoji)"

            >

              {{ emoji }}

            </button>

          </div>

        </div>

        <div class="gb-rich-composer__sticker-wrap">

          <button type="button" class="gb-rich-composer__tool" title="收藏表情" @click.stop="toggleSticker">

            <GuestbookComposerIcons kind="heart" />

          </button>

          <div v-if="stickerOpen" class="gb-rich-composer__sticker-panel" @click.stop>

            <p class="gb-rich-composer__sticker-head">

              <span>收藏表情</span>

              <span>{{ stickers.length }}/{{ MAX_CUSTOM_STICKERS }}</span>

            </p>

            <label class="gb-rich-composer__sticker-add" :class="{ 'is-busy': stickerUploading }">

              <span>＋</span>

              <input

                type="file"

                accept="image/*"

                :disabled="disabled || sending || stickerUploading"

                @change="onPickStickerFile"

              />

            </label>

            <div

              v-for="(item, stickerIndex) in stickers"

              :key="item.id"

              class="gb-rich-composer__sticker-wrap-item"

            >

              <button
                type="button"
                class="gb-rich-composer__sticker"
                @click="pickSticker(item.url)"
                @dblclick.prevent="
                  emit('preview-image', {
                    urls: stickers.map((entry) => entry.url),
                    index: stickerIndex,
                  })
                "
              >

                <img :src="resolveAssetUrl(item.url) || item.url" alt="" />

              </button>

              <button

                type="button"

                class="gb-rich-composer__sticker-remove"

                aria-label="删除收藏表情"

                @click="removeSticker(item.id, $event)"

              >

                ×

              </button>

            </div>

            <p v-if="!stickers.length" class="gb-rich-composer__sticker-empty">从文件夹添加表情</p>

          </div>

        </div>

        <button

          v-if="showSend"

          type="button"

          class="gb-rich-composer__send"

          :disabled="disabled || sending || uploading || (!modelValue.trim() && !images.length)"

          @click="submit"

        >

          {{ sending ? '…' : sendLabel }}

        </button>

      </div>

    </div>

    <p v-if="uploadError" class="gb-rich-composer__error">{{ uploadError }}</p>

    <p v-if="stickerHint" class="gb-rich-composer__hint">{{ stickerHint }}</p>

    <GuestbookConfirmDialog
      :open="Boolean(stickerDeleteTarget)"
      title="删除收藏表情"
      message="确定从收藏中移除这个表情吗？"
      confirm-label="删除"
      danger
      @close="stickerDeleteTarget = null"
      @confirm="confirmRemoveSticker"
    />
  </div>

</template>



<style scoped>

.gb-rich-composer {

  width: 100%;

  min-width: 0;

  box-sizing: border-box;

}



.gb-rich-composer__row {

  display: flex;

  flex-direction: column;

  gap: 8px;

  width: 100%;

  min-width: 0;

}



.gb-rich-composer__input {

  width: 100%;

  min-width: 0;

  box-sizing: border-box;

  border: 2px solid #333;

  border-radius: 12px;

  background: #0a0a0a;

  color: #fff;

  font: inherit;

  font-size: 13px;

  padding: 8px 10px;

  resize: none;

}



.gb-rich-composer__tools {

  display: flex;

  align-items: center;

  gap: 10px;

  flex-wrap: wrap;

  width: 100%;

  min-width: 0;

}



.gb-rich-composer__tool {

  border: 0;

  border-radius: 0;

  background: transparent;

  color: rgba(255, 255, 255, 0.72);

  font: inherit;

  width: 28px;

  height: 28px;

  display: inline-flex;

  align-items: center;

  justify-content: center;

  cursor: pointer;

  padding: 0;

}



.gb-rich-composer__tool:hover {

  color: #fff;

}



.gb-rich-composer__tool--file {

  position: relative;

  overflow: hidden;

}



.gb-rich-composer__tool--file input {

  position: absolute;

  inset: 0;

  opacity: 0;

  cursor: pointer;

}



.gb-rich-composer__send {

  margin-left: auto;

  border: 0;

  border-radius: 999px;

  background: #fbfe00;

  color: #000;

  font: inherit;

  font-size: 12px;

  font-weight: 800;

  padding: 8px 14px;

  cursor: pointer;

}



.gb-rich-composer__send:disabled {

  opacity: 0.45;

  cursor: not-allowed;

}



.gb-rich-composer__emoji-wrap,

.gb-rich-composer__sticker-wrap {

  position: relative;

}



.gb-rich-composer__emoji-panel,

.gb-rich-composer__sticker-panel {

  position: absolute;

  left: 0;

  bottom: calc(100% + 6px);

  z-index: 20;

  display: grid;

  grid-template-columns: repeat(4, 1fr);

  gap: 6px;

  padding: 10px;

  border-radius: 12px;

  border: 2px solid #333;

  background: #111;

  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);

  width: min(220px, 70vw);

  box-sizing: border-box;

}



.gb-rich-composer__emoji-panel {

  /* 8 列：字号 + 内边距 + 间距，避免贴边裁切 */
  grid-template-columns: repeat(8, minmax(0, 1fr));

  gap: 4px;

  padding: 10px;

  width: min(336px, calc(100vw - 24px));

}



.gb-rich-composer__sticker-head {

  grid-column: 1 / -1;

  display: flex;

  align-items: center;

  justify-content: space-between;

  margin: 0 0 2px;

  color: rgba(255, 255, 255, 0.72);

  font-size: 11px;

  font-weight: 700;

}



.gb-rich-composer__emoji {

  border: 0;

  background: transparent;

  font-size: 20px;

  line-height: 1.2;

  cursor: pointer;

  padding: 4px 0;

  min-width: 0;

  display: inline-flex;

  align-items: center;

  justify-content: center;

}



.gb-rich-composer__sticker-wrap-item {

  position: relative;

}



.gb-rich-composer__sticker-add,

.gb-rich-composer__sticker {

  width: 44px;

  height: 44px;

  border-radius: 10px;

  border: 2px dashed #444;

  background: rgba(255, 255, 255, 0.04);

  display: inline-flex;

  align-items: center;

  justify-content: center;

  cursor: pointer;

  padding: 0;

  overflow: hidden;

}



.gb-rich-composer__sticker-add {

  position: relative;

  color: rgba(255, 255, 255, 0.72);

  font-size: 22px;

  font-weight: 700;

}



.gb-rich-composer__sticker-add.is-busy {

  opacity: 0.5;

  pointer-events: none;

}



.gb-rich-composer__sticker-add input {

  position: absolute;

  inset: 0;

  opacity: 0;

  cursor: pointer;

}



.gb-rich-composer__sticker {

  border-style: solid;

  border-color: #333;

}



.gb-rich-composer__sticker img {

  width: 100%;

  height: 100%;

  object-fit: cover;

  display: block;

}



.gb-rich-composer__sticker-remove {

  position: absolute;

  top: -4px;

  right: -4px;

  width: 18px;

  height: 18px;

  border: 0;

  border-radius: 999px;

  background: rgba(0, 0, 0, 0.75);

  color: #fff;

  font-size: 12px;

  line-height: 1;

  cursor: pointer;

}



.gb-rich-composer__sticker-empty {

  grid-column: 1 / -1;

  margin: 0;

  color: rgba(255, 255, 255, 0.45);

  font-size: 11px;

  text-align: center;

}



.gb-rich-composer__images {

  display: flex;

  flex-wrap: wrap;

  gap: 8px;

  margin-bottom: 8px;

}



.gb-rich-composer__thumb {

  position: relative;

  width: 72px;

  height: 72px;

  border-radius: 10px;

  overflow: hidden;

  border: 2px solid #333;

  cursor: zoom-in;

}



.gb-rich-composer__thumb img {

  width: 100%;

  height: 100%;

  object-fit: cover;

}



.gb-rich-composer__thumb button {

  position: absolute;

  top: 2px;

  right: 2px;

  width: 20px;

  height: 20px;

  border: 0;

  border-radius: 999px;

  background: rgba(0, 0, 0, 0.65);

  color: #fff;

  cursor: pointer;

}



.gb-rich-composer__error {

  margin: 6px 0 0;

  color: #ff6b6b;

  font-size: 12px;

}



.gb-rich-composer__hint {

  margin: 6px 0 0;

  color: #bfff09;

  font-size: 12px;

}

</style>

