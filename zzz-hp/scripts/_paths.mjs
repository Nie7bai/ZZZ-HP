/**
 * zzz-hp/scripts 共享路径解析 —— 脚本内禁止写死机器绝对路径。
 *
 * 规范见 dev-docs/scripts-conventions.md。要点：
 * - 仓库内文件：由脚本自身位置推导（不依赖 cwd、不依赖机器）
 * - 仓库外 fixture（方案库导出 JSON）与产物目录（artifacts/）：CLI 参数 > 环境变量 > 默认值
 * - 找不到文件时给出可执行的修复提示，而不是让 readFileSync 抛 ENOENT
 *
 * 开发目录默认 `D:/WB_agent_out/ZZZ-HP`（本机约定，另一个开发目录）；
 * 换机或换位置时设环境变量 ZZZ_DEV_ROOT 覆盖，不需要改脚本。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))

/** 前端工程根（zzz-hp/） */
export const FRONTEND_ROOT = path.resolve(SCRIPT_DIR, '..')
/** 仓库根（含 zzz-hp/ 与 zzz-hp-backend/） */
export const REPO_ROOT = path.resolve(FRONTEND_ROOT, '..')
/** 增益库主数据（仓库内，唯一事实来源） */
export const BUFFS_JSON = path.join(
  REPO_ROOT,
  'zzz-hp-backend',
  'scripts',
  'data',
  'zzz-hp-calculator-buffs.json',
)

/** 开发目录（仓库外，含 artifacts/、dev-docs/、.workbuddy/） */
export const DEV_ROOT = process.env.ZZZ_DEV_ROOT || 'D:/WB_agent_out/ZZZ-HP'
/** 诊断产物目录（probe/bench 的输出落在开发目录，不进仓库） */
export const ARTIFACTS_DIR = process.env.ZZZ_ARTIFACTS_DIR || path.join(DEV_ROOT, 'artifacts')
/** 方案库导出 JSON 的存放目录（人工放入的 fixture） */
export const PROFILES_DIR = path.join(ARTIFACTS_DIR, 'profiles')

/**
 * 解析方案库 JSON 路径。
 * 优先级：argv 传参 > 环境变量 ZZZ_SCHEME_FILE > PROFILES_DIR/<defaultFile>
 * @param {string | undefined} argvValue 命令行传入的路径
 * @param {string} defaultFile 默认 fixture 文件名
 */
export function resolveSchemePath(argvValue, defaultFile = 'scheme-dan.json') {
  const candidate =
    argvValue || process.env.ZZZ_SCHEME_FILE || path.join(PROFILES_DIR, defaultFile)
  if (!fs.existsSync(candidate)) {
    throw new Error(
      `方案库 JSON 不存在：${candidate}\n` +
        `三种用法任选：\n` +
        `  1) node <script> <方案JSON路径>\n` +
        `  2) 设环境变量 ZZZ_SCHEME_FILE=<方案JSON路径>\n` +
        `  3) 把文件放到 ${PROFILES_DIR}/ 下（默认文件名 ${defaultFile}）`,
    )
  }
  return candidate
}

/** 诊断产物输出路径（统一落 ARTIFACTS_DIR，目录按需创建） */
export function artifactPath(fileName) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true })
  return path.join(ARTIFACTS_DIR, fileName)
}

/** 读取并解析 JSON，报错时带上文件路径 */
export function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`文件不存在：${filePath}`)
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}
