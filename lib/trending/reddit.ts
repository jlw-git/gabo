// Reddit mention counter — counts public posts/comments in past 7d that
// mention a venue. Free, no key needed; just be polite with the User-Agent.
//
// Limitations: Reddit's old .json endpoints are unauthenticated but rate-
// limited. We bucket by week and cache aggressively in the cron, so live
// traffic isn't this. Searches are restricted to a handful of SG-relevant
// subreddits to cut noise.

const SG_SUBREDDITS = ['singapore', 'singaporeeats', 'singaporefoodporn']
const USER_AGENT = 'Gabo/1.0 (https://github.com/jlw-git/gabo)'

export type RedditCount = {
  venue_name: string
  mention_count: number
  posts: { title: string; permalink: string; created_utc: number }[]
}

export async function countRedditMentions(venueName: string): Promise<RedditCount> {
  // Quote the name so we get exact-phrase matches; otherwise multi-word venue
  // names dissolve into noise.
  const q = `"${venueName}"`
  const sr = SG_SUBREDDITS.join('+')
  const url = new URL(`https://www.reddit.com/r/${sr}/search.json`)
  url.searchParams.set('q', q)
  url.searchParams.set('restrict_sr', 'on')
  url.searchParams.set('sort', 'new')
  url.searchParams.set('t', 'week')
  url.searchParams.set('limit', '25')

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': USER_AGENT },
  })
  if (!res.ok) {
    return { venue_name: venueName, mention_count: 0, posts: [] }
  }

  const data = (await res.json().catch(() => null)) as RedditSearchResponse | null
  const children = data?.data?.children ?? []
  const cutoff = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60
  const posts = children
    .map((c) => c.data)
    .filter((d): d is RedditPost => Boolean(d) && typeof d.created_utc === 'number' && d.created_utc >= cutoff)
    .map((d) => ({
      title: d.title ?? '',
      permalink: d.permalink ?? '',
      created_utc: d.created_utc,
    }))
  return { venue_name: venueName, mention_count: posts.length, posts }
}

type RedditPost = {
  title?: string
  permalink?: string
  created_utc: number
}

type RedditSearchResponse = {
  data?: {
    children?: { data?: RedditPost }[]
  }
}
