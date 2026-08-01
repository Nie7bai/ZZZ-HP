import { ref } from 'vue'
import {
  uploadCalculatorPublicImage,
  type CalculatorPublicAvatarKind,
} from '@/api/admin'
import AdminImagePicker from '@/components/admin/AdminImagePicker.vue'
import { resolveAssetUrl } from '@/utils/gameData'

export function useCalculatorAvatarUpload(kind: CalculatorPublicAvatarKind) {
  const imageFile = ref<File | null>(null)
  const imagePickerRef = ref<InstanceType<typeof AdminImagePicker> | null>(null)
  const avatarImage = ref<string | null>(null)
  const imagePreview = ref('')

  function onImageChange(file: File | null) {
    imageFile.value = file
    imagePreview.value = file ? URL.createObjectURL(file) : resolveAssetUrl(avatarImage.value) ?? ''
  }

  function setAvatarImage(url: string | null) {
    avatarImage.value = url
    imageFile.value = null
    imagePickerRef.value?.reset()
    imagePreview.value = resolveAssetUrl(url) ?? ''
  }

  function clearAvatarImage() {
    avatarImage.value = null
    imageFile.value = null
    imagePickerRef.value?.reset()
    imagePreview.value = ''
  }

  async function resolveAvatarImageOnSave(entityId: string): Promise<string | null> {
    const id = entityId.trim()
    if (imageFile.value) {
      if (!id) {
        throw new Error('请先填写 ID 再上传头像')
      }
      const uploaded = await uploadCalculatorPublicImage(imageFile.value, kind, id)
      avatarImage.value = uploaded.url
      imageFile.value = null
      imagePickerRef.value?.reset()
      imagePreview.value = resolveAssetUrl(uploaded.url) ?? ''
      return uploaded.url
    }
    return avatarImage.value
  }

  return {
    imageFile,
    imagePickerRef,
    avatarImage,
    imagePreview,
    onImageChange,
    setAvatarImage,
    clearAvatarImage,
    resolveAvatarImageOnSave,
  }
}
