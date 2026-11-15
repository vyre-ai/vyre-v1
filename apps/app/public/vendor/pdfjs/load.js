// Puts pdf.js on a global for the viewer (a module script of the app's own files; nothing is evaluated from strings).
import * as pdfjsLib from "./pdf.js";
globalThis.pdfjsLib = pdfjsLib;
