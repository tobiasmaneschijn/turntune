import { useCallback, useRef, useState, type CSSProperties } from "react";

/** Read the displayed image only; inaccessible canvases keep the neutral border. */
function sampleArtwork(image: HTMLImageElement): string | undefined {
  if (!image.naturalWidth || !image.naturalHeight) return;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 24;
    canvas.height = 24;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    // The center crop avoids thumbnail letterboxing dominating the color.
    context.drawImage(image, image.naturalWidth * .1, image.naturalHeight * .1,
      image.naturalWidth * .8, image.naturalHeight * .8, 0, 0, 24, 24);
    const pixels = context.getImageData(0, 0, 24, 24).data;
    let red = 0, green = 0, blue = 0, total = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const r = pixels[index], g = pixels[index + 1], b = pixels[index + 2];
      const weight = pixels[index + 3] / 255 * (.25 + (Math.max(r, g, b) - Math.min(r, g, b)) / 255);
      red += r * weight; green += g * weight; blue += b * weight; total += weight;
    }
    if (total) return `rgb(${Math.round(red / total)} ${Math.round(green / total)} ${Math.round(blue / total)})`;
  } catch {
    // An otherwise valid cover may not allow CORS canvas reads.
  }
}

export function useArtworkColor(identity: string) {
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const [sample, setSample] = useState<{ identity: string; color: string } | null>(null);
  const onArtworkReady = useCallback((image: HTMLImageElement | null) => {
    if (identityRef.current !== identity) return;
    const color = image ? sampleArtwork(image) : undefined;
    setSample(color ? { identity, color } : null);
  }, [identity]);
  const style = sample?.identity === identity
    ? { "--player-artwork-color": sample.color } as CSSProperties : undefined;
  return { style, onArtworkReady };
}
