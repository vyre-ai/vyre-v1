// Handlers of the previews module: thumbnails, page images and text for file versions (render.ts).

import { renderHandlers } from "./render.ts";

export const handlers = { ...renderHandlers };

export { configurePreviews, processExec, classify, probeImage, decodePng, encodePng, scaleRaster, readZip, officeExtract, pdfPageCount, pdfTextPure, SIZE_WIDTH, MAX_BYTES, MAX_TEXT } from "./render.ts";
export type { PreviewDrivers, Exec, ExecOptions, ExecResult, Raster, SizeKey, OfficeType } from "./render.ts";
