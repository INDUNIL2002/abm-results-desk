import fs from 'node:fs';
import zlib from 'node:zlib';

function createPNG(size, r, g, b) {
  // Simple PNG encoder using Node zlib
  const width = size;
  const height = size;
  
  // Raw RGBA buffer + 1 filter byte per scanline
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  
  const cornerR = Math.floor(size * 0.22);
  const cx = size / 2;
  const cy = size / 2;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * stride;
    raw[rowOffset] = 0; // Filter: None
    
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      
      // Calculate distance to center or corner radius
      let inShape = true;
      if (x < cornerR && y < cornerR) {
        inShape = (Math.hypot(x - cornerR, y - cornerR) <= cornerR);
      } else if (x >= width - cornerR && y < cornerR) {
        inShape = (Math.hypot(x - (width - cornerR), y - cornerR) <= cornerR);
      } else if (x < cornerR && y >= height - cornerR) {
        inShape = (Math.hypot(x - cornerR, y - (height - cornerR)) <= cornerR);
      } else if (x >= width - cornerR && y >= height - cornerR) {
        inShape = (Math.hypot(x - (width - cornerR), y - (height - cornerR)) <= cornerR);
      }
      
      if (!inShape) {
        raw[pxOffset] = 0;
        raw[pxOffset + 1] = 0;
        raw[pxOffset + 2] = 0;
        raw[pxOffset + 3] = 0; // Transparent
        continue;
      }
      
      // Background #183f32
      let pr = r, pg = g, pb = b;

      // Draw leaf/growth emblem in center: #cde1b0
      // Leaf shape roughly: (x-cx)^2 + (y-cy)^2 < (size*0.25)^2
      const dx = (x - cx) / (size * 0.28);
      const dy = (y - cy) / (size * 0.28);
      if (dx * dx + dy * dy <= 1.0) {
        // Light mint leaf color #cde1b0
        pr = 0xcd; pg = 0xe1; pb = 0xb0;
      }
      
      // Diagonal stem line
      if (Math.abs(x - y) <= Math.max(2, size * 0.02) && x >= size * 0.35 && x <= size * 0.65) {
        pr = 0xf6; pg = 0xf8; pb = 0xf2;
      }

      raw[pxOffset] = pr;
      raw[pxOffset + 1] = pg;
      raw[pxOffset + 2] = pb;
      raw[pxOffset + 3] = 255; // Opaque
    }
  }

  const deflated = zlib.deflateSync(raw);

  function crc32(buf) {
    let crc = 0 ^ (-1);
    for (let i = 0; i < buf.length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
    }
    return (crc ^ (-1)) >>> 0;
  }

  // Precompute CRC table
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }

  function makeChunk(type, data) {
    const len = data.length;
    const buf = Buffer.alloc(12 + len);
    buf.writeUInt32BE(len, 0);
    buf.write(type, 4, 4, 'ascii');
    data.copy(buf, 8);
    const crcVal = crc32(buf.subarray(4, 8 + len));
    buf.writeUInt32BE(crcVal, 8 + len);
    return buf;
  }

  // IHDR chunk: 13 bytes
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // 8 bits per channel
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0; // Deflate
  ihdrData[11] = 0; // Filter
  ihdrData[12] = 0; // No interlace

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = makeChunk('IHDR', ihdrData);
  const idat = makeChunk('IDAT', deflated);
  const iend = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

// Generate icon-192.png and icon-512.png with brand green #183f32
fs.writeFileSync('dist/icon-192.png', createPNG(192, 0x18, 0x3f, 0x32));
fs.writeFileSync('dist/icon-512.png', createPNG(512, 0x18, 0x3f, 0x32));
console.log('✓ Generated dist/icon-192.png and dist/icon-512.png successfully!');
