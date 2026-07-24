<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  fetchSiteInfoSections,
  SITE_INFO_PANEL_LABELS,
  SITE_INFO_PANEL_ORDER,
  updateSiteInfoSection,
  type SiteInfoPanelId,
  type SiteInfoSection,
} from '@/api/siteInfo'
import { clearAdminAuthenticated } from '@/utils/adminAuth'

const router = useRouter()

const loading = ref(false)
const savingKey = ref<SiteInfoPanelId | null>(null)
const message = ref('')
const error = ref('')

const forms = reactive<Record<SiteInfoPanelId, { title: string; content: string }>>({
  about: { title: '', content: '' },
  features: { title: '', content: '' },
  credits: { title: '', content: '' },
  legal: { title: '', content: '' },
})

function applySections(list: SiteInfoSection[]) {
  for (const item of list) {
    forms[item.panelKey].title = item.title
    forms[item.panelKey].content = item.content
  }
}

async function loadSections() {
  loading.value = true
  error.value = ''
  try {
    applySections(await fetchSiteInfoSections())
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

async function saveSection(panelKey: SiteInfoPanelId) {
  message.value = ''
  error.value = ''
  const title = forms[panelKey].title.trim()
  const content = forms[panelKey].content.trim()
  if (!title || !content) {
    error.value = `${SITE_INFO_PANEL_LABELS[panelKey]} 的标题和内容均为必填`
    return
  }

  savingKey.value = panelKey
  try {
    const updated = await updateSiteInfoSection(panelKey, { title, content })
    forms[panelKey].title = updated.title
    forms[panelKey].content = updated.content
    message.value = `已保存「${SITE_INFO_PANEL_LABELS[panelKey]}」`
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    savingKey.value = null
  }
}

function logout() {
  clearAdminAuthenticated()
  router.push('/admin/login')
}

onMounted(() => {
  void loadSections()
})
</script>

<template>
  <main class="site-info-admin">
    <RouterLink to="/admin" class="back">← 返回管理员入口</RouterLink>
    <button type="button" class="logout" @click="logout">退出登录</button>

    <header class="page-header">
      <h1>网站说明管理</h1>
      <p>维护前台「网站说明」各栏目内容。网站内容 / 借鉴与参考可使用「【标题】」开头分段，前台会渲染为卡片；正文中的 https:// 链接会自动变为可点击。</p>
      <RouterLink to="/about" class="preview-link" target="_blank">预览前台页面 ↗</RouterLink>
    </header>

    <p v-if="loading" class="hint">加载中…</p>

    <div v-else class="sections">
      <section v-for="panelKey in SITE_INFO_PANEL_ORDER" :key="panelKey" class="card">
        <div class="card-head">
          <h2>{{ SITE_INFO_PANEL_LABELS[panelKey] }}</h2>
          <code>{{ panelKey }}</code>
        </div>

        <label class="field">
          <span>栏目标题</span>
          <input v-model="forms[panelKey].title" type="text" maxlength="120" />
        </label>

        <label class="field">
          <span>正文</span>
          <textarea v-model="forms[panelKey].content" rows="10" />
        </label>

        <button
          type="button"
          class="primary"
          :disabled="savingKey === panelKey"
          @click="saveSection(panelKey)"
        >
          {{ savingKey === panelKey ? '保存中…' : '保存此栏目' }}
        </button>
      </section>
    </div>

    <p v-if="message" class="msg ok">{{ message }}</p>
    <p v-if="error" class="msg err">{{ error }}</p>
  </main>
</template>

<style scoped>
.site-info-admin {
  min-height: 100vh;
  padding: 1.5rem 1.25rem 2.5rem;
  position: relative;
}

.back,
.logout {
  position: absolute;
  top: 1.25rem;
  font-size: 0.85rem;
  text-decoration: none;
  color: var(--color-text);
  opacity: 0.75;
}

.back {
  left: 1.25rem;
}

.logout {
  right: 1.25rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-background-soft);
  padding: 0.35rem 0.8rem;
  cursor: pointer;
}

.back:hover,
.logout:hover {
  opacity: 1;
}

.page-header {
  max-width: 960px;
  margin: 2.5rem auto 1.25rem;
  text-align: center;
}

.page-header h1 {
  margin: 0 0 0.4rem;
  font-size: clamp(1.6rem, 3vw, 2.1rem);
  color: var(--color-heading);
}

.page-header p {
  margin: 0;
  font-size: 0.9rem;
  color: var(--color-text);
  opacity: 0.7;
}

.preview-link {
  display: inline-flex;
  margin-top: 0.75rem;
  font-size: 0.85rem;
  color: var(--color-heading);
}

.sections {
  max-width: 960px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.card {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  padding: 1rem 1.05rem 1.15rem;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.85rem;
}

.card-head h2 {
  margin: 0;
  font-size: 1.05rem;
  color: var(--color-heading);
}

.card-head code {
  font-size: 0.78rem;
  opacity: 0.65;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 0.75rem;
  font-size: 0.85rem;
  color: var(--color-text);
}

.field input,
.field textarea {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-text);
  padding: 0.55rem 0.65rem;
  font: inherit;
}

.field textarea {
  resize: vertical;
  min-height: 160px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.primary {
  border: none;
  border-radius: 8px;
  background: #3d7a5a;
  color: #fff;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
  padding: 0.45rem 0.85rem;
}

.primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.hint {
  max-width: 960px;
  margin: 0 auto;
  font-size: 0.88rem;
  opacity: 0.7;
}

.msg {
  max-width: 960px;
  margin: 0.75rem auto 0;
  font-size: 0.85rem;
}

.msg.ok {
  color: #2f6f4e;
}

.msg.err {
  color: #c44;
}

@media (max-width: 860px) {
  .back,
  .logout {
    position: static;
    display: inline-flex;
    margin-bottom: 0.5rem;
  }

  .page-header {
    margin-top: 0.75rem;
    text-align: left;
  }
}
</style>
