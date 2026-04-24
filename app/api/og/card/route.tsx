import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'

// Renders a 1200×630 social card for a single venue pick. Designed for WhatsApp
// / iMessage previews and for the share modal download. All inputs come from
// query params so the route is stateless.

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const name = p.get('name') ?? 'Date night'
  const address = p.get('address') ?? ''
  const photo = p.get('photo') ?? ''
  const when = p.get('when') ?? ''
  const plannerLabel = p.get('a') ?? 'You'
  const partnerLabel = p.get('b') ?? 'Partner'
  const etaA = p.get('etaA') ?? ''
  const etaB = p.get('etaB') ?? ''
  const gap = p.get('gap') ?? ''

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: '#fafaf9',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Left: photo */}
        <div
          style={{
            display: 'flex',
            width: 560,
            height: '100%',
            background: '#e7e5e4',
          }}
        >
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo}
              alt=""
              width={560}
              height={630}
              style={{ objectFit: 'cover', width: '100%', height: '100%' }}
            />
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100%',
                height: '100%',
                color: '#a8a29e',
                fontSize: 28,
              }}
            >
              Gabo
            </div>
          )}
        </div>

        {/* Right: copy */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            padding: '56px 56px 48px 56px',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                color: '#e11d48',
                fontSize: 16,
                fontWeight: 700,
                letterSpacing: 2,
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  background: '#e11d48',
                }}
              />
              GABO · DATE NIGHT
            </div>
            <div
              style={{
                marginTop: 18,
                fontSize: 52,
                fontWeight: 700,
                lineHeight: 1.05,
                color: '#1c1917',
                display: 'flex',
              }}
            >
              {name}
            </div>
            {address && (
              <div
                style={{
                  marginTop: 12,
                  fontSize: 20,
                  color: '#78716c',
                  display: 'flex',
                }}
              >
                {address}
              </div>
            )}
            {when && (
              <div
                style={{
                  marginTop: 18,
                  fontSize: 22,
                  color: '#1c1917',
                  display: 'flex',
                }}
              >
                {when}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {etaA && (
              <EtaRow color="#0f766e" label={plannerLabel} eta={etaA} />
            )}
            {etaB && (
              <EtaRow color="#b45309" label={partnerLabel} eta={etaB} />
            )}
            {gap && (
              <div
                style={{
                  marginTop: 8,
                  display: 'inline-flex',
                  alignSelf: 'flex-start',
                  padding: '8px 16px',
                  borderRadius: 999,
                  background: '#ecfdf5',
                  color: '#065f46',
                  fontSize: 18,
                  fontWeight: 600,
                }}
              >
                Fair within {gap} min
              </div>
            )}
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  )
}

function EtaRow({ color, label, eta }: { color: string; label: string; eta: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 24 }}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          background: color,
          display: 'flex',
        }}
      />
      <div style={{ color: '#1c1917', fontWeight: 600, display: 'flex' }}>
        {label}
      </div>
      <div style={{ color: '#78716c', display: 'flex' }}>·</div>
      <div style={{ color: '#1c1917', fontWeight: 600, display: 'flex' }}>
        {eta} min
      </div>
    </div>
  )
}
