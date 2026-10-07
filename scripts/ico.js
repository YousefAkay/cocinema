// Builds a multi-size .ico file from PNG images. An ICO is a small header, one 16-byte entry per
// image, then the images; modern browsers read PNG data inside it directly.
// entries: [{ size: 16, png: <Buffer> }, ...]
export function buildIco(entries) {
  if (!entries.length) {
    throw new Error('An icon needs at least one image');
  }

  const headerBytes = 6 + 16 * entries.length;
  const header = Buffer.alloc(headerBytes);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(entries.length, 4);

  let offset = headerBytes;
  entries.forEach(({ size, png }, index) => {
    if (!Number.isInteger(size) || size < 1 || size > 256) {
      throw new Error(`Unsupported icon size: ${size}`);
    }
    const at = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, at); // width (0 means 256)
    header.writeUInt8(size === 256 ? 0 : size, at + 1); // height
    header.writeUInt8(0, at + 2); // colours in palette
    header.writeUInt8(0, at + 3); // reserved
    header.writeUInt16LE(1, at + 4); // colour planes
    header.writeUInt16LE(32, at + 6); // bits per pixel
    header.writeUInt32LE(png.length, at + 8); // image size
    header.writeUInt32LE(offset, at + 12); // image offset
    offset += png.length;
  });

  return Buffer.concat([header, ...entries.map(entry => entry.png)]);
}

// Reads the entries back: [{ width, height, png }]. Used by the tests and the browser check.
export function readIco(buffer) {
  if (buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) {
    throw new Error('Not an ICO file');
  }
  const count = buffer.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const at = 6 + index * 16;
    const size = buffer.readUInt32LE(at + 8);
    const offset = buffer.readUInt32LE(at + 12);
    return {
      width: buffer.readUInt8(at) || 256,
      height: buffer.readUInt8(at + 1) || 256,
      png: buffer.subarray(offset, offset + size),
    };
  });
}
