// Deep-link into the Grab consumer app with the venue pre-filled as drop-off.
// Works on mobile when Grab is installed; silently no-ops on desktop (acceptable
// given the SG market where Grab is ubiquitous on mobile).
export function grabRideUrl(venue: { lat: number; lng: number; name: string }): string {
  const params = new URLSearchParams({
    screenType: 'BOOKING',
    dropOffLatitude: String(venue.lat),
    dropOffLongitude: String(venue.lng),
    dropOffKeywords: venue.name,
  })
  return `grab://open?${params.toString()}`
}
