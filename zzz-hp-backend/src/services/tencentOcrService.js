import tencentcloud from 'tencentcloud-sdk-nodejs'

const OcrClient = tencentcloud.ocr.v20181119.Client

function getClient() {
  const secretId = process.env.TENCENT_SECRET_ID || process.env.TENCENTCLOUD_SECRET_ID
  const secretKey = process.env.TENCENT_SECRET_KEY || process.env.TENCENTCLOUD_SECRET_KEY
  if (!secretId || !secretKey) {
    const err = new Error('未配置腾讯云 OCR 密钥（TENCENT_SECRET_ID / TENCENT_SECRET_KEY）')
    err.code = 'OCR_NOT_CONFIGURED'
    throw err
  }
  return new OcrClient({
    credential: { secretId, secretKey },
    region: process.env.TENCENT_OCR_REGION || 'ap-guangzhou',
    profile: {
      httpProfile: {
        endpoint: 'ocr.tencentcloudapi.com',
      },
    },
  })
}

/**
 * 调用腾讯云 GeneralAccurateOCR（高精度版）
 * @param {Buffer} imageBuffer
 * @returns {Promise<object>} 腾讯 API 原始 Response（含 TextDetections）
 */
export async function recognizePanelImageAccurate(imageBuffer) {
  const client = getClient()
  const imageBase64 = Buffer.from(imageBuffer).toString('base64')
  // 与控制台调试建议一致：拆分粘连数字；IsWords 提升字粒度
  const params = {
    ImageBase64: imageBase64,
    EnableDetectSplit: true,
    IsWords: true,
  }
  const data = await client.GeneralAccurateOCR(params)
  return data
}

export function isOcrConfigured() {
  const secretId = process.env.TENCENT_SECRET_ID || process.env.TENCENTCLOUD_SECRET_ID
  const secretKey = process.env.TENCENT_SECRET_KEY || process.env.TENCENTCLOUD_SECRET_KEY
  return Boolean(secretId && secretKey)
}
