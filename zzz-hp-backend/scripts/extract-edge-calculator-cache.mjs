import { ClassicLevel } from 'classic-level'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ldbPath =
  process.env.EDGE_LDB ||
  path.join(
    process.env.LOCALAPPDATA,
    'Microsoft',
    'Edge',
    'User Data',
    'Default',
    'Local Storage',
    'leveldb',
  )
const outPath =
  process.argv[2] ||
  path.join(__dirname, 'data', 'zzz-hp-calculator-buffs.json')

const KEY = 'zzz-hp-calculator-buffs'

function decodeUtf16Le(buf) {
  if (buf.length % 2 === 1) {
    // sometimes trailing null
    buf = buf.subarray(0, buf.length - (buf.length % 2))
  }
  return Buffer.from(buf).toString('utf16le')
}

function tryParseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function main() {
  const db = new ClassicLevel(ldbPath, {
    createIfMissing: false,
    keyEncoding: 'buffer',
    valueEncoding: 'buffer',
  })

  const candidates = []

  for await (const [keyBuf, valueBuf] of db.iterator()) {
    const keyStr = keyBuf.toString('utf8')
    if (!keyStr.includes(KEY) && !keyBuf.includes(Buffer.from(KEY))) continue

    // Chromium localStorage values are often UTF-16LE JSON
    let text = null
    let parsed = null

    // try utf16le first (common for localStorage)
    try {
      text = decodeUtf16Le(valueBuf)
      parsed = tryParseJson(text)
    } catch {
      // ignore
    }

    if (!parsed) {
      try {
        text = valueBuf.toString('utf8')
        // strip possible leading type byte
        const idx = text.indexOf('{')
        if (idx >= 0) text = text.slice(idx)
        parsed = tryParseJson(text)
      } catch {
        // ignore
      }
    }

    if (!parsed) {
      // value may start with a 1-byte type marker then utf16le
      try {
        text = decodeUtf16Le(valueBuf.subarray(1))
        parsed = tryParseJson(text)
      } catch {
        // ignore
      }
    }

    candidates.push({
      key: keyStr,
      keyHex: keyBuf.toString('hex').slice(0, 80),
      valueBytes: valueBuf.length,
      parsed: Boolean(parsed),
      counts: parsed
        ? {
            agents: parsed.agents?.length,
            wengines: parsed.wengines?.length,
            bangboos: parsed.bangboos?.length,
            driveDiscs: parsed.driveDiscs?.length,
          }
        : null,
      data: parsed,
      preview: (text || '').slice(0, 120),
    })
  }

  await db.close()

  const valid = candidates.filter((c) => c.parsed && c.data?.agents && c.data?.wengines)
  valid.sort((a, b) => b.valueBytes - a.valueBytes)

  console.log(
    JSON.stringify(
      {
        ldbPath,
        candidateCount: candidates.length,
        validCount: valid.length,
        summaries: candidates.map(({ data, ...rest }) => rest),
      },
      null,
      2,
    ),
  )

  if (!valid.length) {
    console.error('No valid calculator cache found in Edge LevelDB')
    process.exit(1)
  }

  const best = valid[0]
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(best.data, null, 2), 'utf8')
  console.log(`Wrote ${outPath}`)
  console.log('counts', best.counts)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
