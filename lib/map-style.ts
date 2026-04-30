import type { StyleSpecification } from 'maplibre-gl'

// Free OpenStreetMap raster tiles. No API key required. Replaces the
// hackathon-era GrabMaps style which now 500s post-event. OSM tile usage
// policy permits low-volume hobby/portfolio use; production traffic should
// move to a hosted provider (MapTiler, Stadia, Mapbox).
export function osmStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: [
          'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
        ],
        tileSize: 256,
        attribution: '&copy; OpenStreetMap contributors',
        maxzoom: 19,
      },
    },
    layers: [
      {
        id: 'osm',
        type: 'raster',
        source: 'osm',
        minzoom: 0,
        maxzoom: 22,
      },
    ],
  }
}
