import { ImageMagick, initializeImageMagick, MagickFormat } from 'npm:@imagemagick/magick-wasm@0.0.35';
import { imageSize } from 'npm:image-size@2.0.2';

let ready: Promise<void> | undefined;
export async function derivatives(input: Uint8Array) {
  const meta = imageSize(input);
  const mime = {jpg:'image/jpeg',png:'image/png',webp:'image/webp'}[meta.type ?? ''];
  if (!mime || !meta.width || !meta.height || meta.width > 6000 || meta.height > 6000 || meta.width * meta.height > 18_000_000) {
    throw new Error('Use a JPEG, PNG, or WebP image up to 18 megapixels.');
  }
  ready ??= Deno.readFile(new URL('magick.wasm',import.meta.resolve('npm:@imagemagick/magick-wasm@0.0.35')))
    .then(bytes=>initializeImageMagick(bytes));
  await ready;
  return ImageMagick.read(input, img=>{
    img.autoOrient();
    img.strip();
    const width = img.width;
    const height = img.height;
    const sizes = [...new Set([Math.min(width,1600),Math.min(width,800),Math.min(width,400)])];
    return { width, height, mime, outputs:sizes.map(w=>{
      const h = Math.max(1,Math.round(height*w/width));
      if (img.width !== w) img.resize(w,h);
      const data = img.write(MagickFormat.Png,result=>Uint8Array.from(result));
      return {w,data};
    }) };
  });
}
