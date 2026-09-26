import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()
const SUMMARY_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8'
const MAX_ARTICLE_LENGTH = 5000

const summarySystemPrompt = `
你是一个专业的文章摘要助手。请通读提供的文章，提炼主要观点、关键信息、数据和结论，并用简洁、准确的中文概括。
要求：保持客观，不歪曲原文；区分事实和观点；不要使用“作者”一词，使用“笔者”代替；不要添加标题或“摘要：”前缀。
输出格式：本文介绍了<文章核心内容>
`

const corsHeaders = {
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['*'],
  maxAge: 86400,
}

app.use('*', cors(corsHeaders))

app.onError((error, c) => {
  console.error('Worker request failed:', error)
  return c.text('Internal Server Error', 500)
})

function getQueryId(c) {
  // The legacy worker turned a missing `id` into the literal string "null".
  return c.req.query('id') ?? 'null'
}

async function sha256(value) {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function md5(value) {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('MD5', data)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function summaryMessages(content, opening = '本文介绍了') {
  return [
    { role: 'system', content: summarySystemPrompt },
    {
      role: 'user',
      content: `${content.substring(0, MAX_ARTICLE_LENGTH)}\n请以“${opening}”开头输出。\n/no_think`,
    },
  ]
}

async function loadArticle(DB, id) {
  return DB.prepare('SELECT content FROM blog_summary WHERE id = ?1')
    .bind(id)
    .first('content')
}

app.get('/', (c) => {
  const id = getQueryId(c)
  if (id !== 'null') {
    return c.redirect('https://www.google.com', 302)
  }

  const request = c.req.raw
  const cf = request.cf ?? {}
  const details = [
    `IP Address: ${c.req.header('cf-connecting-ip') ?? 'Unknown'}`,
    `Country: ${c.req.header('cf-ipcountry') ?? 'Unknown'}`,
    `User-Agent: ${c.req.header('user-agent') ?? 'Unknown'}`,
    `City: ${cf.city ?? 'Unknown'}`,
    `Timezone: ${cf.timezone ?? 'Unknown'}`,
  ]
  return c.text(details.join('\n'))
})

app.get('/summary', async (c) => {
  const { DB, AI } = c.env
  const content = await loadArticle(DB, getQueryId(c))
  if (!content) return c.text('No Record')

  const stream = await AI.run(SUMMARY_MODEL, {
    messages: summaryMessages(content),
    stream: true,
  })

  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  })
})

app.get('/get_summary', async (c) => {
  const { DB, AI } = c.env
  const id = getQueryId(c)
  const sign = c.req.query('sign') ?? 'null'
  const content = await loadArticle(DB, id)
  if (!content) return c.text('no')

  if (await sha256(content) !== sign) return c.text('no')

  const cachedSummary = await DB.prepare('SELECT summary FROM blog_summary WHERE id = ?1')
    .bind(id)
    .first('summary')
  if (cachedSummary) return c.text(cachedSummary)

  const answer = await AI.run(SUMMARY_MODEL, {
    messages: summaryMessages(content, '这篇文章介绍了'),
    stream: false,
  })
  const summary = answer.response?.trim()
  if (!summary) throw new Error('Qwen3 returned an empty summary')

  await DB.prepare('UPDATE blog_summary SET summary = ?1 WHERE id = ?2')
    .bind(summary, id)
    .run()
  return c.text(summary)
})

app.get('/is_uploaded', async (c) => {
  const id = getQueryId(c)
  const sign = c.req.query('sign') ?? 'null'
  const content = await loadArticle(c.env.DB, id)
  if (!content || await sha256(content) !== sign) return c.text('no')
  return c.text('yes')
})

app.post('/upload_blog', async (c) => {
  const id = getQueryId(c)
  const content = await c.req.text()
  const existingArticle = await c.env.DB.prepare(
    'SELECT content FROM blog_summary WHERE id = ?1 LIMIT 1',
  )
    .bind(id)
    .first()

  if (!existingArticle) {
    await c.env.DB.prepare('INSERT INTO blog_summary (id, content) VALUES (?1, ?2)')
      .bind(id, content)
      .run()
  } else if (existingArticle.content !== content) {
    await c.env.DB.prepare('UPDATE blog_summary SET content = ?1, summary = NULL WHERE id = ?2')
      .bind(content, id)
      .run()
  }

  return c.text('OK')
})

app.all('/upload_blog', (c) => c.text('need post'))

app.get('/count_click', async (c) => {
  const idHash = await md5(getQueryId(c))
  const count = await c.env.DB.prepare('SELECT counter FROM counter WHERE url = ?1')
    .bind(idHash)
    .first('counter')
  return c.text(String(count ?? 0))
})

app.get('/count_click_add', async (c) => {
  const idHash = await md5(getQueryId(c))

  // The existing production tables have no unique constraint on `url`; use a
  // transaction batch that increments any existing rows or inserts the first.
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE counter SET counter = COALESCE(counter, 0) + 1 WHERE url = ?1')
      .bind(idHash),
    c.env.DB.prepare(`
      INSERT INTO counter (url, counter)
      SELECT ?1, 1
      WHERE NOT EXISTS (SELECT 1 FROM counter WHERE url = ?1)
    `)
      .bind(idHash),
  ])

  const count = await c.env.DB.prepare('SELECT counter FROM counter WHERE url = ?1 LIMIT 1')
    .bind(idHash)
    .first('counter')
  return c.text(String(count ?? 0))
})

app.all('*', (c) => c.redirect('https://www.google.com', 302))

export default app
