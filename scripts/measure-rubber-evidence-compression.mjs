import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import sharp from "sharp";

const fixtureDirectory = path.resolve("ตัวอย่างใบชั่ง");
const outputArgument = process.argv.indexOf("--output-dir");
const outputDirectory = outputArgument >= 0
  ? path.resolve(process.argv[outputArgument + 1] ?? "")
  : null;
if (outputArgument >= 0 && !process.argv[outputArgument + 1]) {
  throw new Error("--output-dir requires a directory");
}
if (outputDirectory) await mkdir(outputDirectory, { recursive: true });
const candidates = [
  { name: "480-q45", longSide: 480, quality: 45 },
  { name: "720-q55", longSide: 720, quality: 55 },
];

const files = (await readdir(fixtureDirectory))
  .filter((file) => /\.(jpe?g)$/i.test(file))
  .sort();

if (files.length === 0) throw new Error("No JPEG readability fixtures found");

const results = [];
for (const file of files) {
  const inputPath = path.join(fixtureDirectory, file);
  const metadata = await sharp(inputPath).metadata();
  for (const candidate of candidates) {
    const startedAt = performance.now();
    const output = await sharp(inputPath)
      .rotate()
      .resize({
        width: candidate.longSide,
        height: candidate.longSide,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: candidate.quality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    if (outputDirectory) {
      await writeFile(path.join(outputDirectory, `${path.parse(file).name}-${candidate.name}.jpg`), output.data);
    }
    results.push({
      file,
      candidate: candidate.name,
      sourceWidth: metadata.width,
      sourceHeight: metadata.height,
      outputWidth: output.info.width,
      outputHeight: output.info.height,
      bytes: output.info.size,
      encodeMs: Math.round(performance.now() - startedAt),
    });
  }
}

const summary = candidates.map((candidate) => {
  const rows = results.filter((row) => row.candidate === candidate.name);
  return {
    candidate: candidate.name,
    fixtures: rows.length,
    totalBytes: rows.reduce((sum, row) => sum + row.bytes, 0),
    averageBytes: Math.round(rows.reduce((sum, row) => sum + row.bytes, 0) / rows.length),
    maximumBytes: Math.max(...rows.map((row) => row.bytes)),
    totalEncodeMs: rows.reduce((sum, row) => sum + row.encodeMs, 0),
  };
});

console.log(JSON.stringify({ fixtureDirectory, summary, results }, null, 2));
