import type { MapStyle } from '@/lib/metrics';

export const TILE_LAYERS: Record<
  Exclude<MapStyle, 'virtual'>,
  { label: string; url: string; attribution: string; className?: string; maxZoom?: number }
> = {
  topo: {
    label: 'Topo',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© OpenTopoMap (CC-BY-SA)',
    maxZoom: 17,
  },
  osm: {
    label: 'Mapa',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap',
    maxZoom: 19,
  },
  dark: {
    label: 'Oscuro',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '',
    className: 'bilifit-dark-tiles',
    maxZoom: 19,
  },
};

