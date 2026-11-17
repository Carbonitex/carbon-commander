/**
 * Local servers for the end-to-end test:
 *
 * - a mock OpenAI-compatible LLM (`/v1/models`, streaming `/v1/chat/completions`) that plays a
 *   scripted conversation chosen by the first word of the latest user message;
 * - a static fixture site (form, links, a button that changes the DOM, a strict-CSP page, a page
 *   that frames the bar itself).
 *
 * The mock MCP server comes from `tests/helpers/mock-mcp-server.ts`.
 */
import { serveFetch, type RunningHttpServer } from '../helpers/http-server';

// ---------------------------------------------------------------------------------------------
// Mock LLM
// ---------------------------------------------------------------------------------------------

interface WireMessage {
  role: string;
  content: unknown;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

interface Turn {
  text?: string[];
  calls?: { name: string; args: Record<string, unknown> }[];
  /** Delay between text chunks (ms). */
  delayMs?: number;
}

export const XSS_MARKDOWN = [
  'Here are some **tricky** bits:\n\n',
  '<img src="x" onerror="window.__ccXss = 1">\n\n',
  '<script>window.__ccXss = 2</script>\n\n',
  '[click me](javascript:window.__ccXss=3)\n\n',
  '<iframe src="javascript:window.parent.__ccXss=4"></iframe>\n\n',
  '<a href="https://example.com" onclick="window.__ccXss=5">safe link</a>\n\n',
  '<svg><script>window.__ccXss=6</script></svg>',
];

function textOf(message: WireMessage | undefined): string {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((p: unknown) => (typeof p === 'object' && p !== null && 'text' in p ? String((p).text) : ''))
      .join(' ');
  }
  return '';
}

/** Decide the next assistant turn from the conversation so far. */
function script(messages: WireMessage[], fixture: string, tools?: { function: { name: string } }[]): Turn {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user' && typeof messages[i]?.content === 'string') {
      lastUser = i;
      break;
    }
  }
  const prompt = textOf(messages[lastUser]);
  const after = messages.slice(lastUser + 1);
  const toolResults = after.filter((m) => m.role === 'tool');
  const step = after.filter((m) => m.role === 'assistant').length;
  const system = textOf(messages[0]);
  if (system.includes('You complete commands')) {
    const input = /Input: (.*)$/s.exec(prompt)?.[1]?.trim() ?? '';
    return { text: [JSON.stringify({ suggestions: [`${input} this page`, `${input} the selection`] })] };
  }
  const word = prompt.trim().split(/\s+/)[0]?.toLowerCase() ?? '';

  switch (word) {
    case 'hello':
      return { text: ['Hello', ' **world**', '!\n\n- item one\n', '- item `two`'] };
    case 'xss':
      return { text: XSS_MARKDOWN };
    case 'slow':
      return { text: Array.from({ length: 300 }, (_, i) => `chunk${i} `), delayMs: 100 };
    case 'form': {
      if (step === 0) return { calls: [{ name: 'read_page', args: {} }, { name: 'find_elements', args: {} }] };
      if (step === 1) {
        const list = toolResults.map((m) => textOf(m)).join('\n');
        const name = /(e\d+) textbox "Your name"/.exec(list)?.[1];
        const button = /(e\d+) button "Change the heading"/.exec(list)?.[1];
        if (!name || !button) return { text: [`Could not find the elements in: ${list.slice(0, 500)}`] };
        // type_text gets allowed, click gets denied by the test.
        return {
          calls: [
            { name: 'type_text', args: { ref: name, text: 'Ada Lovelace' } },
            { name: 'click', args: { ref: button } },
          ],
        };
      }
      const results = toolResults.slice(-2).map((m) => textOf(m).slice(0, 80));
      return { text: [`Form step done. Results: ${results.join(' | ')}`] };
    }
    case 'click': {
      if (step === 0) return { calls: [{ name: 'click', args: { text: 'Change the heading' } }] };
      return { text: [`Clicked: ${textOf(toolResults.at(-1)).slice(0, 400)}`] };
    }
    case 'navigate': {
      if (step === 0) return { calls: [{ name: 'navigate', args: { url: `${fixture}/page2.html` } }] };
      if (step === 1) return { text: ['Arrived. '], calls: [{ name: 'get_page_info', args: {} }] };
      const title = /^- title: (.*)$/m.exec(system)?.[1] ?? '(none)';
      const url = /^- url: (.*)$/m.exec(system)?.[1] ?? '(none)';
      return { text: [`System prompt now says: ${title} ${url}`] };
    }
    case 'find': {
      if (step === 0) return { calls: [{ name: 'find_elements', args: {} }] };
      return { text: [`Found: ${textOf(toolResults.at(-1)).slice(0, 2000)}`] };
    }
    case 'fetch': {
      if (step === 0) return { calls: [{ name: 'fetch_url', args: { url: 'https://example.com/collect?data=conversation' } }] };
      return { text: [`Fetch result: ${textOf(toolResults.at(-1)).slice(0, 200)}`] };
    }
    case 'dialogclick': {
      if (step === 0) return { calls: [{ name: 'click', args: { selector: '#dialog-button' } }] };
      return { text: [`Dialog click: ${textOf(toolResults.at(-1)).slice(0, 300)}`] };
    }
    case 'shot': {
      if (step === 0) return { calls: [{ name: 'screenshot', args: { quality: 40 } }] };
      return { text: [`Screenshot result: ${textOf(toolResults.at(-1)).slice(0, 60)}`] };
    }
    case 'mcp': {
      if (step === 0) return { calls: [{ name: 'mcp__mock__add', args: { a: 2, b: 3 } }] };
      return { text: [`The MCP sum is ${textOf(toolResults.at(-1))}.`] };
    }
    case 'tools': {
      const names = (tools ?? []).map((t) => t.function.name);
      return { text: [`Tools offered: ${names.length}; has click: ${names.includes('click')}`] };
    }
    default:
      return { text: [`You said: ${prompt}`] };
  }
}

export interface MockLlm extends RunningHttpServer {
  /** Base URL to configure in the extension (`.../v1`). */
  baseUrl: string;
  /** Chat requests received (parsed bodies). */
  requests: { messages: WireMessage[]; tools?: { function: { name: string } }[] }[];
  /** Number of streams aborted by the client. */
  aborted(): number;
}

export async function startMockLlm(fixtureOrigin: string): Promise<MockLlm> {
  const requests: MockLlm['requests'] = [];
  let aborted = 0;
  const encoder = new TextEncoder();
  const running = await serveFetch(async (request) => {
    const url = new URL(request.url);
    if (url.pathname === '/v1/models') {
      return Response.json({ data: [{ id: 'mock-model', name: 'Mock model', context_length: 32000 }] });
    }
    if (url.pathname !== '/v1/chat/completions' || request.method !== 'POST') return new Response('Not found', { status: 404 });
    const body = (await request.json()) as MockLlm['requests'][number] & { stream?: boolean };
    requests.push(body);
    const turn = script(body.messages, fixtureOrigin, body.tools);
    const id = `chatcmpl-${requests.length}`;
    const chunk = (delta: Record<string, unknown>, finish: string | null = null): string =>
      `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: 'mock-model', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    const signal = request.signal;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(chunk({ role: 'assistant', content: '' })));
          for (const piece of turn.text ?? []) {
            if (signal.aborted) {
              aborted++;
              controller.close();
              return;
            }
            controller.enqueue(encoder.encode(chunk({ content: piece })));
            await new Promise((r) => setTimeout(r, turn.delayMs ?? 15));
          }
          (turn.calls ?? []).forEach((call, index) => {
            const callId = `call_${requests.length}_${index}`;
            const args = JSON.stringify(call.args);
            // Arguments split in two chunks, like real providers do.
            controller.enqueue(
              encoder.encode(chunk({ tool_calls: [{ index, id: callId, type: 'function', function: { name: call.name, arguments: args.slice(0, 3) } }] })),
            );
            controller.enqueue(encoder.encode(chunk({ tool_calls: [{ index, function: { arguments: args.slice(3) } }] })));
          });
          controller.enqueue(encoder.encode(chunk({}, turn.calls?.length ? 'tool_calls' : 'stop')));
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } })}\n\n`,
            ),
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch {
          aborted++;
        }
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
  });
  return Object.assign(running, { baseUrl: `${running.origin}/v1`, requests, aborted: () => aborted });
}

// ---------------------------------------------------------------------------------------------
// Fixture site
// ---------------------------------------------------------------------------------------------

const PAGE = (title: string, body: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title></head>
<body>${body}</body></html>`;

const FORM_PAGE = PAGE(
  'Fixture form',
  `<main>
  <h1 id="heading">Original heading</h1>
  <p>This is the fixture page used by the Carbon Commander end-to-end test.</p>
  <form id="form" onsubmit="return false">
    <label for="name">Your name</label>
    <input id="name" name="name" type="text">
  </form>
  <button id="change" type="button">Change the heading</button>
  <nav><a href="/page2.html">Second page</a> · <a href="/csp.html">Strict CSP page</a></nav>
  <script src="/form.js"></script>
</main>`,
);

const FORM_JS = `document.getElementById('change').addEventListener('click', () => {
  document.getElementById('heading').textContent = 'Heading changed by click';
});`;

const PAGE2 = PAGE('Second page', '<main><h1>Second page</h1><p>You navigated here.</p><a href="/">Back</a></main>');

const CSP_PAGE = PAGE('Strict CSP', '<main><h1>Strict CSP page</h1><p>frame-src and child-src are none.</p></main>');

/** A page with a modal <dialog> open (C1). */
const MODAL_PAGE = PAGE(
  'Modal page',
  `<main><h1>Modal page</h1>
  <dialog id="dlg"><p>Confirm your order?</p><button id="dialog-button" type="button">Confirm order</button><p id="dialog-status">pending</p></dialog>
  <script src="/modal.js"></script></main>`,
);
const MODAL_JS = `const d = document.getElementById('dlg');
document.getElementById('dialog-button').addEventListener('click', () => {
  document.getElementById('dialog-status').textContent = 'confirmed';
});
d.showModal();`;

/** Clickable divs (cursor: pointer + a JS listener) inside a landmark role and an app root (C4). */
const CLICKABLES_PAGE = PAGE(
  'Clickables',
  `<div id="app" tabindex="-1"><main role="main"><h1>Clickables</h1>
  <div class="card" id="card-a" style="cursor:pointer">Open card alpha</div>
  <section role="region" aria-label="More"><span class="card" id="card-b" style="cursor:pointer">Open card beta</span></section>
  </main></div>
  <script src="/clickables.js"></script>`,
);
const CLICKABLES_JS = `for (const el of document.querySelectorAll('.card')) el.addEventListener('click', () => (el.dataset.clicked = '1'));`;

export const STRICT_CSP = "default-src 'self'; script-src 'self'; frame-src 'none'; child-src 'none'; object-src 'none'";

export async function startFixtureSite(): Promise<RunningHttpServer> {
  return serveFetch((request) => {
    const path = new URL(request.url).pathname;
    const html = (body: string, headers: Record<string, string> = {}): Response =>
      new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers } });
    switch (path) {
      case '/':
      case '/index.html':
        return html(FORM_PAGE);
      case '/form.js':
        return new Response(FORM_JS, { headers: { 'Content-Type': 'text/javascript' } });
      case '/page2.html':
        return html(PAGE2);
      case '/csp.html':
        return html(CSP_PAGE, { 'Content-Security-Policy': STRICT_CSP });
      case '/modal.html':
        return html(MODAL_PAGE);
      case '/modal.js':
        return new Response(MODAL_JS, { headers: { 'Content-Type': 'text/javascript' } });
      case '/clickables.html':
        return html(CLICKABLES_PAGE);
      case '/clickables.js':
        return new Response(CLICKABLES_JS, { headers: { 'Content-Type': 'text/javascript' } });
      case '/hostile.html':
        return html(PAGE('Hostile', '<main><h1>Hostile page</h1></main>'));
      default:
        return new Response('Not found', { status: 404 });
    }
  });
}
