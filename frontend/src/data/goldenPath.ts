// Real buildings picked from NYC Open Data for the demo; scores are computed live.
export const GOLDEN_PATH = [
  { query: '3605 Sedgwick Avenue, Bronx', note: 'Shed up 3+ yrs · self-closing door violations' },
  { query: '957 Woodycrest Avenue, Bronx', note: 'Shed up 2+ yrs · hundreds of heat complaints' },
  { query: '76 Saint Nicholas Place, Manhattan', note: 'Fire/egress violations · no heat' },
  { query: '225 West 86 Street, Manhattan', note: 'Contrast: The Belnord' },
]

// Opens on Midtown so the city is already on screen
export const INITIAL_VIEW = {
  longitude: -73.9857,
  latitude: 40.7549,
  zoom: 15.4,
  pitch: 55,
  bearing: -28,
}
