import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import worker from '../src/hono.js'

const MODEL = '@cf/qwen/qwen3-30b-a3b-fp8'

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function createEnv({ articles = [], counters = [] } = {}) {
  const articleRows = new Map(articles.map(([id, content, summary = null]) => [id, { content, summary }]))
  const counterRows = new Map(counters)
  const AI = {
    run: vi.fn(async (_model, { stream }) => {
      if (stream) {
        return new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: summary chunk\n\n'))
            controller.close()
          },
        })
      }
      return { response: '这篇文章介绍了测试摘要。' }
    }),
  }

  const DB = {
    prepare(sql) {
      let bindings = []
      const statement = {
        bind(...values) {
          bindings = values
          return statement
        },
        async first(column) {
          const [key] = bindings
          if (sql.includes('SELECT content FROM blog_summary')) {
            return articleRows.get(key)?.content ?? null
          }
          if (sql.includes('SELECT summary FROM blog_summary')) {
            return articleRows.get(key)?.summary ?? null
          }
          if (sql.includes('SELECT counter FROM counter')) {
            return counterRows.get(key) ?? null
          }
          if (sql.includes('INSERT INTO counter')) {
            const count = (counterRows.get(key) ?? 0) + 1
            counterRows.set(key, count)
            return count
          }
          throw new Error(`Unexpected first() query: ${sql}`)
        },
        async run() {
          if (sql.includes('INSERT INTO blog_summary')) {
            const [id, content] = bindings
            const oldRow = articleRows.get(id)
            articleRows.set(id, {
              content,
              summary: oldRow?.content === content ? oldRow.summary : null,
            })
            return { success: true }
          }
          if (sql.includes('UPDATE blog_summary SET summary')) {
            const [summary, id] = bindings
            const row = articleRows.get(id)
            if (row) row.summary = summary
            return { success: true }
          }
          throw new Error(`Unexpected run() query: ${sql}`)
        },
      }
      return statement
    },
  }

  return { DB, AI, articleRows, counterRows }
}

function request(path, init) {
  return new Request(`https://worker.test${path}`, init)
}

describe('Hono summary worker', () => {
  it('preserves the legacy diagnostic root and unknown-path redirect', async () => {
    const env = createEnv()
    const diagnostic = await worker.fetch(request('/?id=null', {
      headers: { 'cf-connecting-ip': '203.0.113.1', 'cf-ipcountry': 'JP' },
    }), env)
    expect(await diagnostic.text()).toContain('Country: JP')

    const redirect = await worker.fetch(request('/not-found'), env)
    expect(redirect.status).toBe(302)
    expect(redirect.headers.get('location')).toBe('https://www.google.com')
  })

  it('uploads content and clears a cached summary only when content changes', async () => {
    const env = createEnv({ articles: [['article-1', 'old content', 'old summary']] })
    const upload = (content) => worker.fetch(request('/upload_blog?id=article-1', {
      method: 'POST',
      body: content,
    }), env)

    expect(await (await upload('old content')).text()).toBe('OK')
    expect(env.articleRows.get('article-1').summary).toBe('old summary')
    expect(await (await upload('new content')).text()).toBe('OK')
    expect(env.articleRows.get('article-1')).toEqual({ content: 'new content', summary: null })
  })

  it('validates signatures, generates a summary once, and serves the cache', async () => {
    const content = 'A short article for the summary test.'
    const env = createEnv({ articles: [['article-2', content]] })
    const sign = await sha256(content)

    const invalid = await worker.fetch(request('/get_summary?id=article-2&sign=wrong'), env)
    expect(await invalid.text()).toBe('no')
    expect(env.AI.run).not.toHaveBeenCalled()

    const first = await worker.fetch(request(`/get_summary?id=article-2&sign=${sign}`), env)
    expect(await first.text()).toBe('这篇文章介绍了测试摘要。')
    expect(env.AI.run).toHaveBeenCalledTimes(1)
    expect(env.AI.run).toHaveBeenCalledWith(MODEL, expect.objectContaining({ stream: false }))

    const cached = await worker.fetch(request(`/get_summary?id=article-2&sign=${sign}`), env)
    expect(await cached.text()).toBe('这篇文章介绍了测试摘要。')
    expect(env.AI.run).toHaveBeenCalledTimes(1)
  })

  it('rejects empty model output without caching it', async () => {
    const content = 'Article with an empty mocked response.'
    const env = createEnv({ articles: [['article-empty', content]] })
    env.AI.run.mockResolvedValueOnce({ response: null })

    const response = await worker.fetch(request(
      `/get_summary?id=article-empty&sign=${await sha256(content)}`,
    ), env)
    expect(response.status).toBe(500)
    expect(env.articleRows.get('article-empty').summary).toBeNull()
  })

  it('checks uploaded signatures and streams summaries', async () => {
    const content = 'Article for the streaming route.'
    const env = createEnv({ articles: [['article-3', content]] })
    const sign = await sha256(content)

    const uploaded = await worker.fetch(request(`/is_uploaded?id=article-3&sign=${sign}`), env)
    expect(await uploaded.text()).toBe('yes')

    const stream = await worker.fetch(request('/summary?id=article-3'), env)
    expect(stream.headers.get('content-type')).toContain('text/event-stream')
    expect(await stream.text()).toContain('summary chunk')
    expect(env.AI.run).toHaveBeenCalledWith(MODEL, expect.objectContaining({ stream: true }))
  })

  it('reads and atomically increments click counters on their respective routes', async () => {
    const env = createEnv()
    const originalDigest = crypto.subtle.digest.bind(crypto.subtle)
    const md5Support = vi.spyOn(crypto.subtle, 'digest').mockImplementation((algorithm, data) => {
      const name = typeof algorithm === 'string' ? algorithm : algorithm.name
      if (name.toUpperCase() === 'MD5') {
        const digest = createHash('md5').update(Buffer.from(data)).digest()
        return Promise.resolve(Uint8Array.from(digest).buffer)
      }
      return originalDigest(algorithm, data)
    })

    try {
      const first = await worker.fetch(request('/count_click_add?id=article-4'), env)
      const second = await worker.fetch(request('/count_click_add?id=article-4'), env)
      const current = await worker.fetch(request('/count_click?id=article-4'), env)

      expect(await first.text()).toBe('1')
      expect(await second.text()).toBe('2')
      expect(await current.text()).toBe('2')
    } finally {
      md5Support.mockRestore()
    }
  })
})
