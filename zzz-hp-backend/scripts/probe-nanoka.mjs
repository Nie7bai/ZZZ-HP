const seasonId = process.argv[2] || '62051'
const html = await fetch(`https://zzz.nanoka.cc/shiyu/${seasonId}`).then((r) => r.text())
const urls = [...html.matchAll(/data-url="([^"]+)"/g)].map((m) => m[1])
console.log('data-urls:')
for (const url of [...new Set(urls)]) console.log(url)

const detailUrl = urls.find((u) => u.includes(`/shiyu/${seasonId}`) || u.includes(`shiyu/${seasonId}.json`) || u.includes(`/${seasonId}.json`))
console.log('\nlikely detail:', detailUrl)

for (const url of [...new Set(urls)].slice(0, 8)) {
  try {
    const res = await fetch(url)
    const text = await res.text()
    console.log('\n====', url, 'status', res.status, 'len', text.length)
    console.log(text.slice(0, 1200))
  } catch (err) {
    console.log('fail', url, err.message)
  }
}
