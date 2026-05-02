// Universal "Get directions" link. Opens Google Maps with the venue as the
// destination — works on every device (web, iOS, Android) without an app
// install, unlike the previous Grab deep-link which silently no-op'd on
// desktop.
export function directionsUrl(venue: { lat: number; lng: number; name: string; address?: string }): string {
  // Prefer name+address so Google Maps resolves the correct POI entry/parking.
  // Fall back to coordinates when no address is available.
  const dest = venue.address
    ? `${venue.name}, ${venue.address}`
    : `${venue.lat},${venue.lng}`
  const params = new URLSearchParams({ api: '1', destination: dest })
  return `https://www.google.com/maps/dir/?${params.toString()}`
}
