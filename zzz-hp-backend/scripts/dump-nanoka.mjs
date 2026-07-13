import fs from 'fs'

const seasonId = process.argv[2] || '62051'
const versionTag = process.argv[3] || '3.1.4+17279672'
const lang = process.argv[4] || 'zh'

const indexUrl = `https://static.nanoka.cc/zzz/${versionTag}/shiyu.json`
const detailUrl = `https://static.nanoka.cc/zzz/${versionTag}/${lang}/shiyu/${seasonId}.json`

const index = await fetch(indexUrl).then((r) => r.json())
const detail = await fetch(detailUrl).then((r) => r.json())

const out = `E:/zzz_HP/zzz-hp-backend/scripts/nanoka-${seasonId}-${lang}.json`
fs.writeFileSync(out, JSON.stringify(detail, null, 2))
console.log('wrote', out)
console.log('season meta', index[seasonId])
console.log('top keys', Object.keys(detail))
console.log('zone keys sample', Object.keys(detail.zone || {}).slice(0, 5))

const zone = detail.zone?.['6205105']
if (zone) {
  console.log('zone 6205105 keys', Object.keys(zone))
  console.log('layer_room keys', Object.keys(zone.layer_room || {}))
  const room = zone.layer_room?.['62051051']
  if (room) {
    console.log('room keys', Object.keys(room))
    console.log('room sample', JSON.stringify(room, null, 2).slice(0, 4000))
  }
}
