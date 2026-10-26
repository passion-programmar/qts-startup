// Minimal PDF files for Apply's proof of an unconfirmed application: a page with a screenshot
// (JPEG), or, when no picture could be taken, the page's text. No library: a PDF of one image or a
// few text lines needs only a handful of objects.

(function initApplyPdf(global) {
  const encoder = new TextEncoder();

  function concat(parts) {
    const chunks = parts.map((part) => (typeof part === 'string' ? encoder.encode(part) : part));
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  /** Builds a PDF from numbered objects (each a string or byte parts), with its cross-reference table. */
  function writePdf(objects) {
    const parts = ['%PDF-1.4\n'];
    const offsets = [];
    let length = encoder.encode(parts[0]).length;
    objects.forEach((body, index) => {
      offsets.push(length);
      const object = concat([`${index + 1} 0 obj\n`, ...[].concat(body), '\nendobj\n']);
      parts.push(object);
      length += object.length;
    });
    const xref = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n',
      ...offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)].join('');
    parts.push(xref, `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`);
    return concat(parts);
  }

  /** Width and height of a baseline or progressive JPEG, from its start-of-frame marker. */
  function jpegSize(bytes) {
    let index = 2;
    while (index + 9 < bytes.length) {
      if (bytes[index] !== 0xff) return null;
      const marker = bytes[index + 1];
      const segment = (bytes[index + 2] << 8) + bytes[index + 3];
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb)) {
        return { height: (bytes[index + 5] << 8) + bytes[index + 6], width: (bytes[index + 7] << 8) + bytes[index + 8] };
      }
      index += 2 + segment;
    }
    return null;
  }

  /** One page holding the screenshot at its own proportions, with a caption line above it. */
  function buildImagePdf(jpegBytes, caption = '') {
    const size = jpegSize(jpegBytes);
    if (!size) throw new Error('The screenshot is not a JPEG image.');
    const pageWidth = 842; // A4 landscape width in points.
    const imageHeight = Math.round((size.height / size.width) * (pageWidth - 40));
    const pageHeight = imageHeight + 70;
    const text = escapeText(caption).slice(0, 180);
    const content = `BT /F1 10 Tf 20 ${pageHeight - 30} Td (${text}) Tj ET\nq ${pageWidth - 40} 0 0 ${imageHeight} 20 20 cm /Im1 Do Q`;
    return writePdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> /Font << /F1 6 0 R >> >> >>`,
      `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream`,
      [`<< /Type /XObject /Subtype /Image /Width ${size.width} /Height ${size.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`, jpegBytes, '\nendstream'],
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ]);
  }

  function escapeText(value) {
    // Standard PDF fonts cover Latin-1; other characters are shown as "?".
    return String(value)
      .replace(/[^\x20-\x7e\xa0-\xff]/g, '?')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  function wrapLine(line, width = 110) {
    const words = String(line).split(/\s+/);
    const lines = [];
    let current = '';
    for (const word of words) {
      if ((current + ' ' + word).trim().length > width) {
        if (current) lines.push(current);
        current = word.slice(0, width);
      } else {
        current = (current + ' ' + word).trim();
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [''];
  }

  /** Pages of plain text: the page-text fallback when no screenshot could be taken. */
  function buildTextPdf(title, text) {
    const lines = [title, '', ...String(text).split(/\n/).flatMap((line) => wrapLine(line))].slice(0, 600);
    const perPage = 60;
    const pages = [];
    for (let start = 0; start < lines.length; start += perPage) pages.push(lines.slice(start, start + perPage));
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      null,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    const kids = [];
    for (const pageLines of pages) {
      const content = `BT /F1 9 Tf 12 TL 30 812 Td ${pageLines.map((line) => `(${escapeText(line)}) Tj T*`).join(' ')} ET`;
      objects.push(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream`);
      const contentNumber = objects.length;
      objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentNumber} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
      kids.push(`${objects.length} 0 R`);
    }
    objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
    return writePdf(objects);
  }

  function toBase64(bytes) {
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
  }

  const api = { buildImagePdf, buildTextPdf, jpegSize, toBase64 };
  global.__qtsApplyPdf = Object.freeze(api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
