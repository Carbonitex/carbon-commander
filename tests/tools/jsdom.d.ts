// Minimal typing for the bits of jsdom the injection test uses (jsdom ships no types).
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: { runScripts?: 'outside-only' | 'dangerously'; url?: string; pretendToBeVisual?: boolean });
    readonly window: Window & typeof globalThis & { eval(source: string): unknown };
  }
}
