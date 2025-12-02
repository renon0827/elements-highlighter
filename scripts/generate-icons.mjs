import sharp from 'sharp';
import { mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'icons');

async function generateIcons() {
  await mkdir(iconsDir, { recursive: true });

  const sizes = [16, 48, 128];
  const svgBase = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
      <rect x="8" y="8" width="112" height="112" rx="8" fill="#4A90D9"/>
      <rect x="20" y="20" width="40" height="30" fill="none" stroke="#fff" stroke-width="4" rx="2"/>
      <rect x="68" y="20" width="40" height="30" fill="none" stroke="#fff" stroke-width="4" rx="2"/>
      <rect x="20" y="58" width="88" height="50" fill="none" stroke="#fff" stroke-width="4" rx="2"/>
      <circle cx="28" cy="28" r="10" fill="#FF4444"/>
      <text x="28" y="33" font-family="Arial" font-size="14" font-weight="bold" fill="#fff" text-anchor="middle">1</text>
      <circle cx="76" cy="28" r="10" fill="#FF4444"/>
      <text x="76" y="33" font-family="Arial" font-size="14" font-weight="bold" fill="#fff" text-anchor="middle">2</text>
      <circle cx="28" cy="66" r="10" fill="#FF4444"/>
      <text x="28" y="71" font-family="Arial" font-size="14" font-weight="bold" fill="#fff" text-anchor="middle">3</text>
    </svg>
  `;

  for (const size of sizes) {
    const outputPath = join(iconsDir, `icon${size}.png`);
    await sharp(Buffer.from(svgBase))
      .resize(size, size)
      .png()
      .toFile(outputPath);
    console.log(`Generated: ${outputPath}`);
  }

  console.log('All icons generated!');
}

generateIcons().catch(console.error);
