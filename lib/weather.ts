// Singapore weather via NEA's open data. Used server-side by /api/plan to
// decide whether outdoor venues should be excluded (PRD §4.1).
//
// Endpoints:
//   - 24h forecast:  https://api-open.data.gov.sg/v2/real-time/api/twenty-four-hr-forecast
//   - 4-day outlook: https://api-open.data.gov.sg/v2/real-time/api/four-day-outlook
// No auth required. Free, SG-authoritative.

export type WeatherCondition = 'clear' | 'rain'

export type WeatherResult = {
  condition: WeatherCondition
  source: 'nea-24h' | 'nea-4day' | 'default'
  text: string | null
}

type TwentyFourHourPeriod = {
  timePeriod?: {
    start?: string
    end?: string
  }
  regions?: {
    central?: {
      text?: string
    }
  }
}

type FourDayForecast = {
  timestamp?: string
  forecast?: {
    text?: string
    summary?: string
  }
}

const RAIN_PATTERN = /shower|rain|thunder/i

function classify(text: string | undefined | null): WeatherCondition {
  if (!text) return 'clear'
  return RAIN_PATTERN.test(text) ? 'rain' : 'clear'
}

export async function fetchWeatherCondition(at: Date): Promise<WeatherResult> {
  const now = Date.now()
  const hoursOut = (at.getTime() - now) / 3_600_000

  if (hoursOut < 0 || hoursOut > 96) {
    return { condition: 'clear', source: 'default', text: null }
  }

  try {
    if (hoursOut <= 24) {
      const res = await fetch(
        'https://api-open.data.gov.sg/v2/real-time/api/twenty-four-hr-forecast',
        { next: { revalidate: 300 } } // 5-min edge cache
      )
      if (!res.ok) throw new Error(`nea 24h ${res.status}`)
      const data = await res.json()
      const record = data?.data?.records?.[0]
      const period = ((record?.periods ?? []) as TwentyFourHourPeriod[]).find((p) => {
        const start = new Date(p.timePeriod?.start ?? '').getTime()
        const end = new Date(p.timePeriod?.end ?? '').getTime()
        return at.getTime() >= start && at.getTime() < end
      })
      const text =
        period?.regions?.central?.text ?? record?.general?.forecast?.text ?? null
      return { condition: classify(text), source: 'nea-24h', text }
    }

    // 24 < hoursOut ≤ 96 → 4-day outlook
    const res = await fetch(
      'https://api-open.data.gov.sg/v2/real-time/api/four-day-outlook',
      { next: { revalidate: 1800 } } // 30-min edge cache
    )
    if (!res.ok) throw new Error(`nea 4day ${res.status}`)
    const data = await res.json()
    const forecasts = (data?.data?.records?.[0]?.forecasts ?? []) as FourDayForecast[]
    const day = forecasts.find((f) => {
      if (!f.timestamp) return false
      const ts = new Date(f.timestamp).toDateString()
      return ts === at.toDateString()
    })
    const text = day?.forecast?.text ?? day?.forecast?.summary ?? null
    return { condition: classify(text), source: 'nea-4day', text }
  } catch {
    return { condition: 'clear', source: 'default', text: null }
  }
}
