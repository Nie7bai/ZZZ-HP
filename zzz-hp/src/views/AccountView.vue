<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useUserAuthStore } from '@/stores/userAuth'

/** 兼容旧链接：账号中心已并入留言板内 */
const router = useRouter()
const auth = useUserAuthStore()

function redirectToGuestbookAccount() {
  if (!auth.ready) return
  if (!auth.isLoggedIn) {
    auth.openLoginDialog()
    void router.replace({ path: '/', query: { guestbook: '1' } })
    return
  }
  void router.replace({ path: '/', query: { guestbook: '1', account: '1' } })
}

onMounted(() => {
  redirectToGuestbookAccount()
})

watch(
  () => auth.ready,
  (ready) => {
    if (ready) redirectToGuestbookAccount()
  },
)
</script>

<template>
  <div class="account-redirect">
    <p>正在打开留言板账号中心…</p>
  </div>
</template>

<style scoped>
.account-redirect {
  min-height: 40vh;
  display: grid;
  place-items: center;
  color: rgba(255, 255, 255, 0.55);
  font-size: 14px;
  font-weight: 700;
}
</style>
