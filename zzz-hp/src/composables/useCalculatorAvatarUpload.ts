import { ref } from 'vue'
import {
  ensureCalculatorPublicAvatar,
  uploadCalculatorPublicImage,
  type CalculatorPublicAvatarKind,
} from '@/api/admin'
import AdminImagePicker from '@/components/admin/AdminImagePicker.vue'
import { resolveAssetUrl } from '@/utils/gameData'

const FIXED_AVATAR_PREFIX: Record<CalculatorPublicAvatarKind, string> = {
  agent: '/character/',
  wengine: '/wengine/',
  drive_disc: '/drive_disc/',
  bangboo: '/bangboo/',
}

/** 与后端 calculatorAvatarFileBaseName 对齐：ID 可含 `&`，文件名不能直接用 */
export function calculatorAvatarFileBaseName(entityId: string) {
  return entityId.trim().replace(/[&<>:"/\\|?*\u0000-\u001f]/g, '_')
}

function isFixedAvatarUrl(kind: CalculatorPublicAvatarKind, url: string, entityId: string) {
  const prefix = FIXED_AVATAR_PREFIX[kind]
  const id = entityId.trim()
  const safeBase = `${prefix}${calculatorAvatarFileBaseName(id)}`
  const legacyBase = `${prefix}${id}`
  return (
    url === safeBase ||
    url.startsWith(`${safeBase}.`) ||
    url === legacyBase ||
    url.startsWith(`${legacyBase}.`)
  )
}

export function useCalculatorAvatarUpload(kind: CalculatorPublicAvatarKind) {
  const imageFile = ref<File | null>(null)
  const imagePickerRef = ref<InstanceType<typeof AdminImagePicker> | null>(null)
  const avatarImage = ref<string | null>(null)
  const imagePreview = ref('')
  /** 用户点了「清除头像」才允许保存时写成 null */
  const clearedByUser = ref(false)

  function onImageChange(file: File | null) {
    imageFile.value = file
    clearedByUser.value = false
    imagePreview.value = file ? URL.createObjectURL(file) : resolveAssetUrl(avatarImage.value) ?? ''
  }

  function setAvatarImage(url: string | null) {
    avatarImage.value = url
    imageFile.value = null
    clearedByUser.value = false
    imagePickerRef.value?.reset()
    imagePreview.value = resolveAssetUrl(url) ?? ''
  }

  function clearAvatarImage() {
    avatarImage.value = null
    imageFile.value = null
    clearedByUser.value = true
    imagePickerRef.value?.reset()
    imagePreview.value = ''
  }

  /**
   * @param entityId 角色/音擎等 id
   * @param fallbackUrl 当前库里已有头像；未选新图且未点清除时保留，避免空保存冲掉库字段
   */
  async function resolveAvatarImageOnSave(
    entityId: string,
    fallbackUrl?: string | null,
  ): Promise<string | null> {
    const id = entityId.trim()
    if (clearedByUser.value && !imageFile.value) {
      return null
    }

    if (imageFile.value) {
      if (!id) {
        throw new Error('请先填写 ID 再上传头像')
      }
      const uploaded = await uploadCalculatorPublicImage(imageFile.value, kind, id)
      avatarImage.value = uploaded.url
      imageFile.value = null
      clearedByUser.value = false
      imagePickerRef.value?.reset()
      imagePreview.value = resolveAssetUrl(uploaded.url) ?? ''
      return uploaded.url
    }

    const current = avatarImage.value?.trim() || fallbackUrl?.trim() || null
    if (!current || !id) return current

    if (!isFixedAvatarUrl(kind, current, id)) {
      try {
        const ensured = await ensureCalculatorPublicAvatar(kind, id, current)
        avatarImage.value = ensured.url
        imagePreview.value = resolveAssetUrl(ensured.url) ?? ''
        return ensured.url
      } catch {
        // 旧文件找不到时仍写回固定路径，便于之后补文件
        const fixed = `${FIXED_AVATAR_PREFIX[kind]}${calculatorAvatarFileBaseName(id)}.webp`
        avatarImage.value = fixed
        imagePreview.value = resolveAssetUrl(fixed) ?? ''
        return fixed
      }
    }

    avatarImage.value = current
    imagePreview.value = resolveAssetUrl(current) ?? ''
    return current
  }

  return {
    imageFile,
    imagePickerRef,
    avatarImage,
    imagePreview,
    clearedByUser,
    onImageChange,
    setAvatarImage,
    clearAvatarImage,
    resolveAvatarImageOnSave,
  }
}
