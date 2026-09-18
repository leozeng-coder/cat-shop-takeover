import { preparePalette, recolorPixels } from './palette-colors.js';

self.onmessage = ({ data: { id, image, skin, source } }) => {
  try {
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    image.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    recolorPixels(pixels.data, preparePalette(skin, source));
    context.putImageData(pixels, 0, 0);
    const result = canvas.transferToImageBitmap();
    self.postMessage({ id, image: result }, [result]);
  } catch (error) {
    image.close();
    self.postMessage({ id, error: error.message });
  }
};
