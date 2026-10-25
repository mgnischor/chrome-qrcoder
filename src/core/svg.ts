/*
    QRCoder Chrome Extension
    Copyright (C) 2026 Miguel Nischor

    File: src/core/svg.ts
    Description: Renders a QR code as a standalone SVG document.
    Author: Miguel Nischor <miguel@nischor.com.br>

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/
import type { QrCode } from "./encoder";

/** Light modules around the symbol that scanners need to find it. The standard asks for at least four. */
export const QUIET_ZONE = 4;

/** Pixels per module of the SVG's nominal size. The image scales freely, this only sets its default size. */
const SVG_MODULE_PIXELS = 8;

/**
 * Lists the horizontal runs of dark modules, so that neighbours are drawn as one rectangle.
 *
 * @param qr - The code to scan.
 * @returns Runs as `{ x, y, length }` in module coordinates, row by row.
 */
export function darkRuns(qr: QrCode): { x: number; y: number; length: number }[] {
    const runs: { x: number; y: number; length: number }[] = [];
    for (let y = 0; y < qr.size; y++) {
        const row = qr.modules[y]!;
        for (let x = 0; x < qr.size; ) {
            if (!row[x]) {
                x++;
                continue;
            }
            let end = x;
            while (end < qr.size && row[end]) end++;
            runs.push({ x, y, length: end - x });
            x = end;
        }
    }
    return runs;
}

/**
 * Renders a QR code as an SVG document: black modules on a white background, with the quiet zone included.
 *
 * @param qr - The code to render.
 * @param border - Quiet zone in modules.
 * @returns The SVG source, ready to be saved as a `.svg` file.
 */
export function toSvg(qr: QrCode, border = QUIET_ZONE): string {
    const side = qr.size + border * 2;
    const path = darkRuns(qr)
        .map(({ x, y, length }) => `M${x + border},${y + border}h${length}v1h-${length}z`)
        .join("");
    const pixels = side * SVG_MODULE_PIXELS;
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" width="${pixels}" height="${pixels}" ` +
        `shape-rendering="crispEdges">` +
        `<rect width="${side}" height="${side}" fill="#fff"/><path d="${path}" fill="#000"/></svg>\n`
    );
}
