// Appearance-only mapping for warm fur. Geometry, alpha and animation timing stay intact.
const clamp = (value) => Math.max(0, Math.min(1, value));
const mix = (a, b, t) => a + (b - a) * t;
function smooth(a, b, value) {
  const t = clamp((value - a) / (b - a));
  return t * t * (3 - 2 * t);
}
function rgb(hex) {
  if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error(`Invalid palette color: ${hex}`);
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
}

export function preparePalette(skin, source) {
  return {
    original: skin.original === true,
    fur: rgb(skin.fur),
    stripe: rgb(skin.stripe),
    highlight: rgb(skin.highlight),
    white: rgb(skin.white),
    source,
  };
}

export function recolorPixels(pixels, palette, start = 0, end = pixels.length) {
  if (palette.original) return;
  const profile = palette.source;
  const [hueMin, hueMax] = profile.hueRange;
  const [saturationLow, saturationHigh] = profile.furSaturation;
  const [shadowLightness, bodyLightness, highlightLightness] = profile.furLightness;
  for (let i = start; i < end; i += 4) {
    if (pixels[i + 3] === 0) continue;
    const r = pixels[i] / 255,
      g = pixels[i + 1] / 255,
      b = pixels[i + 2] / 255;
    const high = Math.max(r, g, b),
      low = Math.min(r, g, b),
      chroma = high - low;
    if (chroma < 0.005 || high === 0) continue;
    const hue =
      ((high === r ? (g - b) / chroma : high === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4) * 60 +
        360) %
      360;
    if (hue <= hueMin || hue >= hueMax) continue;
    const saturation = chroma / high,
      lightness = (high + low) / 2;
    const warm =
      smooth(hueMin, hueMin + profile.hueFeather, hue) *
      (1 - smooth(hueMax - profile.hueFeather, hueMax, hue));
    const fur =
      warm *
      smooth(...profile.outlineLightness, lightness) *
      smooth(saturationLow, saturationHigh, saturation);
    const pale =
      warm *
      smooth(...profile.paleLightness, lightness) *
      smooth(profile.paleSaturation[0], profile.paleSaturation[0] + 0.04, saturation) *
      (1 - smooth(profile.paleSaturation[1] - 0.08, profile.paleSaturation[1], saturation));
    if (fur === 0 && pale === 0) continue;
    const lowTone = lightness <= bodyLightness ? palette.stripe : palette.fur;
    const highTone = lightness <= bodyLightness ? palette.fur : palette.highlight;
    const t =
      lightness <= bodyLightness
        ? clamp((lightness - shadowLightness) / (bodyLightness - shadowLightness))
        : clamp((lightness - bodyLightness) / (highlightLightness - bodyLightness));
    const shadow = lightness < shadowLightness ? 0.65 + 0.35 * clamp(lightness / shadowLightness) : 1;
    for (let channel = 0; channel < 3; channel++) {
      const tintedFur = mix(lowTone[channel], highTone[channel], t) * shadow;
      const tintedWhite = palette.white[channel] * Math.min(1, lightness / 0.94);
      pixels[i + channel] = Math.round(
        mix(mix(pixels[i + channel], tintedFur, fur), tintedWhite, pale * (1 - fur)),
      );
    }
  }
}
