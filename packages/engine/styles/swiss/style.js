/* Swiss grid: International Typographic Style in motion. Off-white paper, a strict 12-column grid, huge black grotesk
 * type, one signal red, flat geometric blocks; words and numbers are the actors. For business, strategy and opinion. */
window.EXTRA_FONTS = (window.EXTRA_FONTS || []).concat([
  '900 40px "Noto Sans SC Variable"', '700 40px "Noto Sans SC Variable"', '500 40px "Noto Sans SC Variable"',
  '900 40px "Inter Tight Variable"', '700 40px "Inter Tight Variable"', '500 40px "Inter Tight Variable"',
  '400 40px "Archivo Black"', '500 30px "IBM Plex Mono"',
]);
window.STYLE = {
  id: 'swiss',
  // geometry, not sketch: no wobble, one clean stroke, a heavier rule
  roughScale: 0, bowScale: 0, sw: 4, single: true,
  // black on paper, one signal red; blue/yellow are poster primaries for a second fact only; *F fills are flat tints
  palette: {
    ink: '#111111', soft: '#3C3C3A', muted: '#8A8984', faint: '#CFCCC4',
    red: '#E3321D', redF: '#F6CFC6',        // signal red: THE accent — the point, the number that matters
    blue: '#1D3FBB', blueF: '#D3DAF2',      // cobalt: a second, contrasting fact (rare)
    yellow: '#F4C20D', paper: '#F3F1EC',    // poster yellow; paper = the ground itself
    orange: '#F07A12', orangeF: '#FBDDC2',  // warning / cost only
    green: '#127A4A', greenF: '#CFE6D9',    // success only
    purple: '#5B4B8A', purpleF: '#DEDAEA',
    inkF: '#E3E0D9', softF: '#E8E5DF', mutedF: '#ECEAE4', faintF: '#F0EEE9',
  },
  // warm off-white with the 12-column grid printed almost invisibly, plus a fine print grain
  background: (stage) => {
    const m = stage.area.x0, g = 24, cw = (stage.w - 2 * m - 11 * g) / 12;
    const cols = Array.from({ length: 12 }, (_, i) => `<rect x="${(m + i * (cw + g)).toFixed(1)}" y="0" width="${cw.toFixed(1)}" height="${stage.h}" fill="#000" fill-opacity="0.018"/>`).join('');
    const grid = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${stage.w}" height="${stage.h}">${cols}</svg>`);
    const grain = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="9" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.1  0 0 0 0 0.1  0 0 0 0 0.1  0 0 0 0.06 0"/></filter><rect width="300" height="300" filter="url(#n)"/></svg>');
    return [`url("data:image/svg+xml;utf8,${grain}")`, `url("data:image/svg+xml;utf8,${grid}") 0 0 / ${stage.w}px ${stage.h}px no-repeat`, '#F3F1EC'].join(',');
  },
};
