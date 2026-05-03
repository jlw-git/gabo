// Universal "Get directions" link. Opens Google Maps with the venue as the
// destination — works on every device (web, iOS, Android) without an app
// install.
//
// Free-text destinations like "name, address" used to land on the wrong POI
// in shared buildings: e.g. Lucine by LUNA at 111 Somerset Road resolved to
// "Arch Angel Brow" because that business outranks the cafe in Google's POI
// index. The fix:
//   - For Google-Places-sourced venues, pass `destination_place_id` (the
//     stable place ID we already store as source_id). Google routes exactly
//     to that listing and shows the correct name/photo on the map.
//   - For everything else (editorial blog scrapes, Bandsintown, museum,
//     Foursquare), pass `lat,lng`. Coordinates beat text search every time;
//     the user already saw the venue name on the card.
export function directionsUrl(venue: {
  lat: number
  lng: number
  name: string
  address?: string | null
  source?: string | null
  source_id?: string | null
}): string {
  const params = new URLSearchParams({ api: '1' })

  if (venue.source === 'google_places' && venue.source_id) {
    params.set('destination', venue.name)
    params.set('destination_place_id', venue.source_id)
  } else {
    params.set('destination', `${venue.lat},${venue.lng}`)
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`
}
