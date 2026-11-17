/**
 * Entry of the `webmcp.js` bundle: the MAIN-world, `document_start` script the worker registers
 * while `Settings.webmcp` is on. Kept tiny; see `page-api.ts`.
 */
import { installModelContext } from './page-api';

installModelContext(window);
