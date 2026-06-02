// Great-circle (haversine) distance between two lat/lng points, in km.
// Extracted from VenueDetailModal's cross-rec logic so the itinerary composer
// (F2) can pre-rank venue pairs by proximity before spending OneMap routing
// calls on them.

type Coord = { lat: number; lng: number }

export function distanceKm(a: Coord, b: Coord): number {
  const R = 6371
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}
