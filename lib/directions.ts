// Universal "Get directions" link. Opens Google Maps with the venue as the
// destination — works on every device (web, iOS, Android) without an app
// install, unlike the previous Grab deep-link which silently no-op'd on
// desktop.
export function directionsUrl(venue: { lat: number; lng: number; name: string }): string {
  const params = new URLSearchParams({
    api: '1',
    destination: `${venue.lat},${venue.lng}`,
  })
  void venue.name
  return `https://www.google.com/maps/dir/?${params.toString()}`
}
