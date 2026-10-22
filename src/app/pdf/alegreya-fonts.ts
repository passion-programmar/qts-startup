import {
  alegreyaBoldGzipBase64,
  alegreyaItalicGzipBase64,
  alegreyaRegularGzipBase64,
} from "@/app/pdf/alegreya-font-data";

type AlegreyaFonts = {
  regular: Uint8Array;
  bold: Uint8Array;
  italic: Uint8Array;
};

let fontPromise: Promise<AlegreyaFonts> | undefined;

export function loadAlegreyaFonts(): Promise<AlegreyaFonts> {
  fontPromise ??= Promise.all([
    decompress(alegreyaRegularGzipBase64),
    decompress(alegreyaBoldGzipBase64),
    decompress(alegreyaItalicGzipBase64),
  ]).then(([regular, bold, italic]) => ({ regular, bold, italic }));
  return fontPromise;
}

async function decompress(value: string): Promise<Uint8Array> {
  const binary = atob(value);
  const compressed = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const stream = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
