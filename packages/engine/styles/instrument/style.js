/* Instrument: an idea built as a small precision instrument on a bench and drawn as a technical figure: paper-white solid
 * parts shaded by facing, graphite hairlines, one part lit in signal orange, on a card with a figure number, a legend and
 * a live readout. For how algorithms, systems and mechanisms work. The kit (kit.js) holds P.bench(...) and its parts. */
window.EXTRA_FONTS = (window.EXTRA_FONTS || []).concat([
  '600 40px "Inter Tight Variable"', '500 40px "Inter Tight Variable"', '300 40px "Inter Tight Variable"',
  '600 40px "Noto Sans SC Variable"', '500 40px "Noto Sans SC Variable"',
  '500 30px "IBM Plex Mono"', '600 30px "IBM Plex Mono"',
]);
window.STYLE = {
  id: 'instrument',
  // drafted, not sketched: no wobble, one clean stroke
  roughScale: 0, bowScale: 0, sw: 2, single: true,
  // graphite on paper; one signal orange for the part to watch; blue only for what flows through the machine
  palette: {
    ink: '#26262A', soft: '#57575A', muted: '#8A8A8F', faint: '#D6D6D9',
    orange: '#FF4F00', orangeF: '#FFE2D4',  // THE accent: the lit part, the needle, the moving ball
    blue: '#3E63DD', blueF: '#DCE4FA',      // what flows: a signal, current, a request
    green: '#30A46C', greenF: '#D5F0E2',    // a match, a pass
    red: '#E5484D', redF: '#FADBDC',        // a fault, a mismatch
    purple: '#8E4EC6', purpleF: '#EBDDF7',
    yellow: '#E2A400', paper: '#FBFBFA',
    inkF: '#E9E9E6', softF: '#EEEEEB', mutedF: '#F2F2EF', faintF: '#F6F6F3',
  },
  // a pale grey page with the white figure card on it: a hairline border, registration ticks in its corners
  background: (stage) => {
    const W = stage.w, H = stage.h, x0 = 72, y0 = 40, x1 = W - 72, y1 = stage.area.y1 + 12;
    const tick = (x, y, dx, dy) => `<path d="M${x} ${y + dy * 14} L${x} ${y} L${x + dx * 14} ${y}" fill="none" stroke="#26262A" stroke-width="1.6"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#FBFBFA" stroke="#B4B4B8" stroke-width="1.5"/><line x1="${x0 + 40}" y1="${y1 - 70}" x2="${x1 - 40}" y2="${y1 - 70}" stroke="#E2E2E4" stroke-width="1.2"/>${tick(x0 + 10, y0 + 10, 1, 1)}${tick(x1 - 10, y0 + 10, -1, 1)}${tick(x0 + 10, y1 - 10, 1, -1)}${tick(x1 - 10, y1 - 10, -1, -1)}</svg>`;
    return [`url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") 0 0 / ${W}px ${H}px no-repeat`, '#ECECE8'].join(',');
  },
};
