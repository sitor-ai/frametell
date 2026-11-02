/* Pixel game: an 8-bit console world. Pages are low-resolution scenes (320×180 logical pixels, each 6 screen pixels)
 * painted by kit.js on a nearest-neighbour canvas: dithered skies, tile levels, outlined sprites, chunky pixel type. */
window.EXTRA_FONTS = (window.EXTRA_FONTS || []).concat(['400 40px "Press Start 2P"', '400 40px "DotGothic16"', '400 40px "Pixelify Sans Variable"', '700 40px "Pixelify Sans Variable"']);
window.STYLE = {
  id: 'pixel',
  // vector shapes, when a page uses them at all, are hard-edged: no wobble, one stroke, a chunky line
  roughScale: 0, bowScale: 0, sw: 6, single: true,
  // a console palette on a night-blue ground: ink is near-white, *F fills are deep tints (panels, not light boxes)
  palette: {
    ink: '#FCFCFC', soft: '#BCBCBC', muted: '#7C7C7C', faint: '#3C3C5C',
    blue: '#3CBCFC', blueF: '#0B2A6B',      // sky cyan: the main path, the player's side
    orange: '#FCA044', orangeF: '#4A2A10',  // coin gold-orange: score, cost, the thing being collected
    red: '#F83800', redF: '#4A1208',        // NES red: danger, error, the enemy
    green: '#58D854', greenF: '#0E3A12',    // 1-UP green: success, go, done
    purple: '#B87CFC', purpleF: '#2A1650',
    yellow: '#F8D878', paper: '#16163A',    // paper = a raised panel one step above the ground
    inkF: '#2A2A54', softF: '#24244A', mutedF: '#1E1E42', faintF: '#1A1A3E',
  },
  // night-blue ground with a crisp pixel starfield (each star a 6×6 block on the 6px grid, no blur, no glow)
  background: (stage) => {
    const W = stage.w / 6, H = stage.h / 6;   // 320×180 logical pixels (180×320 in portrait)
    let r = 7, stars = '';
    const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) {
      const x = Math.floor(rnd() * W), y = Math.floor(rnd() * H * 0.72), big = rnd() < 0.18;
      stars += `<rect x="${x}" y="${y}" width="1" height="1" fill="${big ? '#FCFCFC' : '#6C6CB4'}"/>`;
      if (big) stars += `<rect x="${x - 1}" y="${y}" width="3" height="1" fill="#FCFCFC" opacity="0.35"/><rect x="${x}" y="${y - 1}" width="1" height="3" fill="#FCFCFC" opacity="0.35"/>`;
    }
    const svg = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${stage.w}" height="${stage.h}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges">${stars}</svg>`);
    return [
      `url("data:image/svg+xml;utf8,${svg}")`,
      'linear-gradient(#0C0C2C 0%, #0C0C2C 34%, #16124A 34%, #16124A 62%, #24186C 62%, #24186C 84%, #3A1E7C 84%)',
    ].join(',');
  },
};
