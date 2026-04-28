# Shiva 멀티 커서 (Multi-Agent Cursor) — 포팅 가이드

> **One sentence**: 한 응답에 LLM이 발행한 여러 도구 호출이 *동시에* 실행되며, 각 도구는 색·라벨·역할이 다른 전담 커서로 화면 위에서 보이게 움직이고 클릭한다 — 시바(시바신)의 여러 손이 서로 다른 UI를 동시에 다루는 비주얼.

**Source 레퍼런스**: AARO Northlight Regulation (정북일조사선 볼륨 생성기)
**Last verified**: `src/` against current main, prompt-version `5.0.0-progressive`
**Audience**: 다른 Next.js + Anthropic Agent SDK 앱에 동일 패턴을 이식하려는 엔지니어 — 이 문서만 읽고 자기 레포에 적용 가능하도록 작성됨.

> **이 문서를 읽는 두 가지 방법**
> 1. **빠른 포팅**: §A → §B → §C → §D 순서로 따라가면 30~60분 내 동작.
> 2. **깊은 이해**: §1 ~ §16 차례로 읽으며 각 결정의 *왜*를 익힌다.
>
> **에이전트 역할 정의는 이식 레포의 책임이다.** 이 문서는 *프레임워크*만 제공한다 — 색/라벨/도구 세트는 §3, §B에서 너의 도메인에 맞게 직접 정의한다.

---

## 0. 무엇이고 왜 만드는가

### 0.1 정의
**Shiva 멀티 커서** = LLM 에이전트의 *결과만* 보여주는 게 아니라 *과정*을 보여주는 인터랙션 패턴. 핵심 3 요소:

1. **Vivid Cursor (단일)**: 에이전트가 사람처럼 마우스를 움직여 UI를 조작한다 — 슬라이더 thumb 위치를 정확히 계산하고, 클릭하기 전에 짧은 "결정 시간"을 두며, 자연스러운 곡선/jitter로 도착한다.
2. **Multi-Cursor (병렬)**: 한 응답에 *여러* tool_use 블록이 오면 클라이언트가 fire-and-forget으로 동시 실행 → 서로 다른 색의 커서 N개가 각자의 UI에서 동시에 일한다.
3. **역할 기반 안정 ID (Shiva Roles)**: 같은 종류의 도구는 같은 ID 커서를 *재사용*하므로 깜빡임이 없고, 작업 후 잔류하여 "누가 무엇을 했는지" 시각적으로 남는다.

### 0.2 왜 굳이?
- LLM이 "면적을 200으로 줄였습니다"라고 말하는 것보다 **여러 색 커서가 사이드바와 캔버스를 동시에 만지는 것**이 압도적으로 신뢰가 간다.
- 사용자는 "에이전트가 무엇을 했는지" 디스패치 직후가 아닌 *애니메이션 도중*에 알 수 있다 → 중단 결정도 일찍 가능.
- 디자인 검토 도구처럼 *공동 작업 중*이라는 메타포가 자연스러운 도메인에 가장 잘 맞는다 (Figma multiplayer ↔ 에이전트 매니저 ↔ 멀티 손 신).

### 0.3 Anti-패턴 (의도적으로 막은 것)
- 모든 도구를 직렬 await → 비주얼이 시퀀셜해져 매니저 메타포가 깨진다. **반드시 fire-and-forget**.
- 매 도구 호출마다 새 커서 spawn → 깜빡임. **역할별 안정 ID로 재사용**.
- 작업 후 즉시 despawn → 누가 뭘 했는지 사라진다. **AGENT_RESET 전까지 잔류**.
- 도구 핸들러가 서버에서 reducer를 흉내낸다 → 비주얼이 사라지고 SDK + 클라 의존성 분리 실패. **서버 핸들러는 ack만**, 실제 동작은 *DOM이 있는 브라우저*에서.

---

## 1. 시스템 아키텍처 (한눈에)

```
┌──────────────────────────────────────────────────────────────────┐
│ User: "층고 4m + 최대 28m + 제2종 일반주거"                        │
│                ↓                                                 │
│ POST /api/agent/chat (messages + appState 자동 첨부)             │
│                ↓                                                 │
│ Server: Anthropic Agent SDK query() + in-process MCP 서버        │
│         (N tools, 모두 ack만 — 실행은 클라가)                     │
│                ↓ SSE                                             │
│         tool_use_start ×3 (id, name 통보) → text_delta           │
│         → assistant 메시지 (확정된 input) → tool_use_end ×3      │
│                ↓                                                 │
│ Client useAgent.ts:                                              │
│   for each tool_use_end:                                         │
│     fire-and-forget executeTool(name, input)  ← await 없음!      │
│     pendingTools.add(promise)                                    │
│   await Promise.allSettled(pendingTools) → AGENT_DONE            │
│                                                                  │
│   ↓ 동시에 N개 promise가 진행                                     │
│                                                                  │
│ tool-executor.ts:                                                │
│   <toolA>  → operateUIElement('role-A', ...)                     │
│   <toolB>  → operateUIElement('role-B', ...)                     │
│   <toolC>  → operateUIElement('role-C', ...)                     │
│                                                                  │
│   각각:                                                           │
│   1. uiRegistry.getRect(uiId) → DOMRect                          │
│   2. cursorStore.spawnAgent(stableId, role meta)                 │
│   3. tweenAgent(stableId, x, y, fittsDuration) ← bezier+jitter   │
│   4. await sleep(150) ← "deciding" pause                         │
│   5. apply() → dispatch reducer action                           │
│   6. updateAgent(variant: 'thinking') ← 잔류                     │
│                                                                  │
│ → N개의 다른 색 커서가 동시에 자기 UI를 향해 날아가 클릭 후 머문다.   │
└──────────────────────────────────────────────────────────────────┘
```

### 1.1 모듈 책임

| 모듈 | 역할 | 포팅 시 |
|------|------|---------|
| `lib/cursor-store.ts` | 외부 store + 트윈 + 속도/플로킹 | **그대로 복사** (storage key prefix만 교체) |
| `lib/ui-registry.ts` | 사이드바 컨트롤의 DOMRect getter 등록 | **그대로 복사** (UI_IDS는 도메인별 재정의) |
| `lib/sse-parser.ts` | SSE 스트림 파싱 | **그대로 복사** |
| `components/CursorOverlay.tsx` | 커서 DOM 렌더 (외부 store 구독, transform 직접 갱신) | **그대로 복사** |
| `hooks/useUserCursorTracking.ts` | 사용자 마우스 → store mirror | **그대로 복사** |
| `hooks/useAgent.ts` | SSE 파싱 + fire-and-forget 동시 실행 | **그대로 복사** (state/dispatch 타입만 교체) |
| `agent/tool-executor.ts` | 도구 디스패처 + 역할 정의 + `operateUIElement` | **템플릿 + 도구별 작성** (§B-3) |
| `app/api/agent/chat/route.ts` | Anthropic Agent SDK + in-process MCP server + SSE | **템플릿 + 도구 스키마 작성** (§B-2) |
| `agent/system-prompt.ts` | 태스크 매니저 메타포 시스템 프롬프트 | **도메인별 작성** (§B-1) |
| `app/globals.css` (커서 블록) | 커서 화살표/버블/잔류 애니메이션 | **그대로 복사** (색은 ROLES에서 인라인) |

### 1.2 의존성 (검증된 버전)

```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2",
    "next": "16+",
    "react": "19+",
    "zod": "^3 또는 ^4"
  }
}
```

이식 시 **단일 외부 의존**은 Anthropic Agent SDK뿐. 나머지(트윈/UI registry/store)는 모두 50~350줄 자체 구현이라 그대로 복사 가능.

> **Next.js 16 주의**: App Router 기준. `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`을 SSE route에 명시. 이 레포의 `AGENTS.md`처럼 *최신 버전을 가정하지 말고* `node_modules/next/dist/docs/`의 가이드를 먼저 확인할 것.

---

# Part A — Quick Start (포팅 30~60분)

## §A. 빠른 포팅 체크리스트

새 레포에 *Shiva 멀티 커서를 살리는 가장 짧은 길*. 각 단계의 결과물은 §B에서 확장한다.

### A-1. 의존성 설치
```bash
npm i @anthropic-ai/claude-agent-sdk zod
# react, next, typescript는 이미 있다고 가정
```

### A-2. 인증 (Anthropic Agent SDK)
- Claude Code CLI Max 플랜 로그인이 가장 쉬움. 터미널에서 `claude /login`.
- 또는 `ANTHROPIC_API_KEY` 환경 변수.

### A-3. 5개 모듈을 그대로 복사
다음 파일은 **도메인 무관**하게 그대로 복사한다 (변경 시 깜빡임/race가 즉시 발생).

1. `src/lib/cursor-store.ts` — §2에 본문 전체. storage key prefix(`aaro.*`)만 자기 앱 이름으로 sed.
2. `src/lib/ui-registry.ts` — §4. `UI_IDS` 상수만 자기 도메인으로 비워두고 시작.
3. `src/lib/sse-parser.ts` — §8.4.
4. `src/components/CursorOverlay.tsx` — §6.
5. `src/hooks/useUserCursorTracking.ts` — §6.2.
6. `src/app/globals.css`의 *Cursor Overlays* CSS 블록 (§10.4~10.7).

### A-4. 도메인별 4개 모듈을 템플릿에서 작성
| 파일 | 무엇을 채우나 |
|------|--------------|
| `src/agent/system-prompt.ts` | 도메인 1단락 + ROLES 카탈로그 + 동시성 원칙 (§B-1) |
| `src/app/api/agent/chat/route.ts` | MCP 서버 + zod 스키마 + ack 핸들러 (§B-2) |
| `src/agent/tool-executor.ts` | ROLES + 각 도구의 cursor + apply() (§B-3) |
| `src/hooks/useAgent.ts` | dispatch 타입만 교체 (§7) |

### A-5. 루트에 마운트
```tsx
// app/layout.tsx 또는 AppLayout
import CursorLayer from '@/components/CursorOverlay';
import { useUserCursorTracking } from '@/hooks/useUserCursorTracking';

export default function RootLayout({ children }) {
  useUserCursorTracking('나');   // 사용자 라벨
  return (
    <html><body>
      {children}
      <CursorLayer />            {/* fixed z-index: 9999 */}
    </body></html>
  );
}
```

### A-6. 등록 패턴으로 사이드바 컨트롤 노출
```tsx
function MySlider({ value, ... }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() =>
    uiRegistry.register('my-slider-id', () => ref.current?.getBoundingClientRect() ?? null),
    []
  );
  return <input ref={ref} type="range" ... />;
}
```

§A 완료 시 **에이전트가 너의 UI를 향해 가짜 커서로 클릭하는 모습**을 보게 된다. 이후 §B에서 도메인을 풍부하게 만든다.

---

# Part B — Per-Repo Templates (도메인 정의)

## §B-1. system-prompt.ts 템플릿

**이식 레포의 책임**: 도메인 한 단락 + 역할 카탈로그 + 도구 사용 가이드. 이 레포의 예시 (§9)는 *건축 일조사선* 도메인이지만, 너의 도메인은 다르다.

```ts
// agent/system-prompt.ts
export const PROMPT_VERSION = '1.0.0-<your-app>';   // 코드와 함께 진화

export const SYSTEM_PROMPT = `당신은 <도메인 한 줄>의 **태스크 매니저 에이전트**입니다.
사용자 요청을 분석하여 필요한 만큼의 **서브 에이전트(전담 커서)**에 작업을 분배·지휘합니다.

## 도메인 지식 (간결하게)
<도메인의 *법칙·관계·단위·좌표계*를 5~10줄로. 모든 도구가 공유하는 사전 지식.>

## ★ 태스크 매니저 + 서브 에이전트 (Shiva 모델)

당신은 매니저, 도구는 **서브 에이전트(전담 커서)**.
**한 서브 에이전트는 한 가지 작업만** 수행합니다 — 시바의 여러 손이 각자 다른 도구를 다루듯.

### 서브 에이전트 카탈로그

| 라벨 (색) | 담당 영역 | 처리하는 도구 |
|-----------|----------|---------------|
| <역할A> (<색A>) | <UI 영역A> | <toolA1>, <toolA2>, ... |
| <역할B> (<색B>) | <UI 영역B> | <toolB1>, ... |
| ...                                                            |

### ★ 핵심 동시성 원칙
**독립 작업은 한 응답에 모두 발행 → 병렬 실행됨.**
한 응답 안의 여러 tool_use 블록은 **클라이언트에서 동시에** 시작합니다.

- ✅ 독립적: <toolA> + <toolB> + <toolC> → 한 응답에 3개 호출 → 3 커서 병렬
- ⚠️ 의존적: <toolX> 후 <toolY>(X의 결과 ID 사용) → 다음 응답에서

### 작업 규모 적응
- 단순 요청 → 서브 에이전트 1명만 깨운다.
- 복합 요청 → 필요한 만큼만 깨운다 (불필요한 도구 호출 금지).

각 서브 에이전트는 작업이 끝나도 자기 UI 영역에 머물며 누가 무엇을 했는지 보입니다.

## 작업 원칙 (반드시 준수)
1. <도메인 규칙 1>
2. <도메인 규칙 2>
...

## 사용 가능한 도구 (N개)
| 이름 | 기능 |
|------|------|
| <toolA1> | ... |
| ...                                                            |

## 응답 톤
- 한국어/영어/... + 간결 + 1~3문장 + (도메인이라면 법규 인용 형식 등)

## 금지 사항
- 도구 호출 없이 거짓 보고 금지
- get_<state> 매 turn 호출 금지 (자동 첨부됨)
- ...
`;
```

### B-1 작성 팁

- **도메인 단락이 짧을수록 좋다**: 5~10줄. LLM은 도구 정의에서 더 많은 컨텍스트를 흡수한다.
- **역할 카탈로그가 LLM의 지도다**: 어떤 도구가 어떤 색 커서를 만드는지 *명시*해야 LLM이 "한 응답에 여러 색을 동시에 띄울 수 있다"는 걸 학습한다.
- **의존/독립 예시**: 각 1개 이상. 너의 도메인에서 가장 자주 발생할 의존 시나리오를 명시해야 race를 피한다.
- **버전 명명 규칙**: `<major>.<minor>.<patch>-<descriptor>`. descriptor가 프롬프트의 *세대*를 나타낸다 (e.g., `5.0.0-progressive`는 점진적 동작 도입 세대).

## §B-2. /api/agent/chat/route.ts 템플릿

```ts
// app/api/agent/chat/route.ts
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { SYSTEM_PROMPT, PROMPT_VERSION } from '@/agent/system-prompt';
import type { AppStateSummary } from '@/agent/state-summary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MCP_SERVER_NAME = '<your-app>';      // 예: 'parking', 'invoice', 'design'
const TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

const myServer = createSdkMcpServer({
  name: MCP_SERVER_NAME,
  alwaysLoad: true,
  tools: [
    // 모든 핸들러는 ack만. 실제 동작은 클라이언트가 한다.
    tool(
      'set_<param>',
      '<도메인에서 의미 있는 한 줄 설명. LLM이 이걸 보고 호출 시점/방식을 판단한다.>',
      { value: z.number().min(0).max(100) },   // zod schema
      async (a) => ({ content: [{ type: 'text', text: `[<param> ${a.value}]` }] }),
    ),
    tool(
      'get_<state>',
      '현재 상태를 반환. (자동 첨부되므로 명시 호출 불필요.)',
      {},
      async () => ({ content: [{ type: 'text', text: '상태는 메시지에 첨부되어 있습니다.' }] }),
    ),
    // ... 너의 도구 N개
  ],
});

const ALLOWED_TOOLS = [
  'set_<param>', 'get_<state>', /* ... */
].map((n) => `${TOOL_PREFIX}${n}`);

const DISALLOWED_TOOLS = [
  'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
  'WebFetch', 'WebSearch', 'NotebookEdit', 'Task', 'TodoWrite',
];

interface AgentChatRequest {
  messages: { role: 'user' | 'assistant'; content: string }[];
  appState: AppStateSummary;     // 도메인별 state 타입
}

function formatPrompt(req: AgentChatRequest): string {
  const stateBlock =
    `[현재 상태 — prompt-version=${PROMPT_VERSION}]\n` +
    '```json\n' + JSON.stringify(req.appState, null, 2) + '\n```';
  if (req.messages.length <= 1) {
    return `${stateBlock}\n\n${req.messages.at(-1)?.content ?? ''}`;
  }
  const history = req.messages.slice(0, -1)
    .map((m) => `${m.role === 'user' ? '사용자' : '에이전트'}: ${m.content}`)
    .join('\n\n');
  const latest = req.messages.at(-1)?.content ?? '';
  return `${stateBlock}\n\n[이전 대화]\n${history}\n\n[새 사용자 메시지]\n${latest}`;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as AgentChatRequest;
  // ... validation ...
  const promptText = formatPrompt(body);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const abort = new AbortController();
      const toolBuffers = new Map<string, { id: string; name: string }>();
      const emittedToolEnds = new Set<string>();

      try {
        const iter = query({
          prompt: promptText,
          options: {
            systemPrompt: SYSTEM_PROMPT,
            mcpServers: { [MCP_SERVER_NAME]: myServer },
            allowedTools: ALLOWED_TOOLS,
            disallowedTools: DISALLOWED_TOOLS,
            includePartialMessages: true,
            permissionMode: 'bypassPermissions',
            maxTurns: 12,
            abortController: abort,
          },
        });
        for await (const m of iter) {
          if (m.type === 'stream_event') {
            const ev = m.event;
            if (ev.type === 'content_block_start') {
              const block = ev.content_block;
              if (block.type === 'text') send('text_start', { index: ev.index });
              else if (block.type === 'tool_use') {
                const name = block.name.startsWith(TOOL_PREFIX)
                  ? block.name.slice(TOOL_PREFIX.length) : block.name;
                toolBuffers.set(block.id, { id: block.id, name });
                send('tool_use_start', { index: ev.index, id: block.id, name });
              }
            } else if (ev.type === 'content_block_delta') {
              if (ev.delta.type === 'text_delta')
                send('text_delta', { index: ev.index, text: ev.delta.text });
              // input_json_delta: 의도적으로 무시 (병렬 도구일 때 race) — §8.3 참조
            }
          } else if (m.type === 'assistant') {
            const content = m.message?.content ?? [];
            for (const block of content) {
              if (block.type === 'tool_use' && !emittedToolEnds.has(block.id)) {
                const name = block.name.startsWith(TOOL_PREFIX)
                  ? block.name.slice(TOOL_PREFIX.length) : block.name;
                send('tool_use_end', { id: block.id, name, input: block.input ?? {} });
                emittedToolEnds.add(block.id);
              }
            }
          } else if (m.type === 'result') {
            const isError =
              m.subtype !== 'success' || ('is_error' in m && m.is_error === true);
            const text = 'result' in m ? m.result : null;
            if (isError) {
              const message = text
                ?? ('errors' in m && m.errors?.length ? m.errors.join('; ') : `agent ${m.subtype}`);
              send('error', { message });
            } else send('done', { result: text });
            break;
          }
        }
      } catch (err) {
        send('error', { message: err instanceof Error ? err.message : String(err) });
      } finally {
        try { abort.abort(); } catch {}
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
```

### B-2 주요 결정점

- **MCP 서버 이름**: `mcp__<server>__<tool>` 형식이 SDK 컨벤션. 짧고 도메인 한 단어 (`northlight`, `parking`, ...).
- **AllowedTools/DisallowedTools**: SDK는 기본으로 Bash/Read/Write 등을 노출한다. *반드시* 차단해서 LLM이 너의 도구만 쓰게 하라.
- **`includePartialMessages: true`**: text_delta 스트리밍에 필요.
- **`maxTurns`**: 12 정도. 도구 결과가 다음 turn 입력으로 들어가는 경우(이 레포는 self-contained라 거의 불필요)를 위한 안전판.
- **`result` 이벤트의 `is_error`**: SDK는 "성공인데 사실은 거부 응답"인 경우(`subtype='success'` & `is_error=true`)가 있다. 둘 다 error로 취급해야 사용자가 깨끗한 메시지를 본다.

## §B-3. tool-executor.ts 템플릿 (Shiva 코어)

```ts
// agent/tool-executor.ts
import { z } from 'zod';
import { cursorStore, tweenAgent, fittsDuration, sleep } from '@/lib/cursor-store';
import { uiRegistry, sliderThumbX, UI_IDS } from '@/lib/ui-registry';

/* ── 1. ROLES — 너의 도메인 역할 사전 ──
 * 역할 = (label, color) 쌍. 도구 → 역할 → cursor id → 안정 재사용.
 * 도메인의 "어느 영역에서 사람이 일을 하는가"로 분류한다.
 */
const ROLES = {
  // 예시 (§3.3 디자인 가이드 참조하여 너의 도메인으로 교체):
  // builder:      { label: '도형',   color: '#E8784B' },
  // tunerA:       { label: '슬라이더A', color: '#7B6CD9' },
  // selector:     { label: '선택', color: '#5B8DEF' },
  // proposer:     { label: '제안', color: '#C7942A' },
} as const;

const BUILDER_ID = 'default';   // 메인 작업 커서. 채팅 패널에서 spawn.

/* ── 2. Executor context ── */
export interface ExecutorContext {
  dispatch: (action: <YourAction>) => void;
  getState: () => <YourState>;
  // 캔버스가 있다면:
  // getViewport: () => { cx: number; cy: number; zoom: number };
  // getCanvasSize: () => { width: number; height: number; rect: DOMRect | null };
}

export interface ExecutorResult {
  status: 'applied' | 'rejected' | 'failed';
  message?: string;
}

/* ── 3. operateUIElement — 모든 UI 도구의 공통 의식 ──
 * spawn-or-reuse → travel(Fitts) → pause(decide) → apply → park(thinking)
 * 등록되지 않은 UI는 fallback으로 즉시 apply (테스트/CI 환경).
 */
async function operateUIElement(
  cursorId: string,
  uiId: string,
  role: keyof typeof ROLES,
  apply: () => void,
  options: {
    targetX?: (rect: DOMRect) => number;
    targetY?: (rect: DOMRect) => number;
  } = {},
) {
  const rect = uiRegistry.getRect(uiId);
  if (!rect) { apply(); return; }
  const x = options.targetX ? options.targetX(rect) : rect.left + rect.width / 2;
  const y = options.targetY ? options.targetY(rect) : rect.top + rect.height / 2;
  const meta = ROLES[role];
  cursorStore.spawnAgent(cursorId, {
    label: meta.label, color: meta.color, variant: 'pen', visible: true,
  });
  const cur = cursorStore.getSnapshot().agents[cursorId];
  const dur = cur ? fittsDuration(cur.x, cur.y, x, y) : 400;
  await tweenAgent(cursorId, x, y, dur);
  await sleep(150);                          // brief "deciding" pause
  apply();                                    // ← 실제 reducer dispatch
  cursorStore.updateAgent(cursorId, { variant: 'thinking' });   // park
}

/* ── 4. progressiveSlider — 슬라이더는 점진적으로 ──
 * 시작 값에서 목표 값까지 N단계로 드래그하며 매 단계마다 dispatch.
 * 사용자는 핸들이 *슬라이드*하는 것과 바운드 state가 함께 변하는 걸 본다.
 */
async function progressiveSlider(
  cursorId: string,
  uiId: string,
  role: keyof typeof ROLES,
  fromValue: number,
  toValue: number,
  min: number,
  max: number,
  apply: (v: number) => void,
  steps = 10,
) {
  const rect = uiRegistry.getRect(uiId);
  if (!rect) { apply(toValue); return; }
  const meta = ROLES[role];
  const y = rect.top + rect.height / 2;

  cursorStore.spawnAgent(cursorId, {
    label: meta.label, color: meta.color, variant: 'pen', visible: true,
  });
  const startX = sliderThumbX(rect, fromValue, min, max);
  const cur = cursorStore.getSnapshot().agents[cursorId];
  const initialDur = cur ? fittsDuration(cur.x, cur.y, startX, y) : 400;
  await tweenAgent(cursorId, startX, y, initialDur);
  await sleep(120);

  if (Math.abs(toValue - fromValue) > 1e-6) {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const v = fromValue + (toValue - fromValue) * t;
      const stepX = sliderThumbX(rect, v, min, max);
      await tweenAgent(cursorId, stepX, y, 70);
      apply(v);
      if (i < steps) await sleep(30 + 20 * (1 - t));
    }
  } else apply(toValue);

  cursorStore.updateAgent(cursorId, { variant: 'thinking' });
}

/* ── 5. 도구 핸들러 N개 ── */
const setParamSchema = z.object({ value: z.number().min(0).max(100) });

async function execSetParam(input: unknown, ctx: ExecutorContext): Promise<ExecutorResult> {
  const args = setParamSchema.parse(input);
  const cur = ctx.getState().<param>;
  await progressiveSlider(
    'tuner-param', UI_IDS.SLIDER_PARAM, 'tunerA',
    cur, args.value, 0, 100,
    (v) => ctx.dispatch({ type: 'SET_PARAM', value: Math.round(v) }),
  );
  return { status: 'applied', message: `<param> ${cur} → ${args.value}` };
}

/* ── 6. Dispatcher ── */
export async function executeTool(
  name: string,
  input: unknown,
  ctx: ExecutorContext,
): Promise<ExecutorResult> {
  try {
    switch (name) {
      case 'set_<param>': return await execSetParam(input, ctx);
      // ... 너의 도구들
      default: return { status: 'rejected', message: `알 수 없는 도구: ${name}` };
    }
  } catch (err) {
    return { status: 'failed', message: err instanceof Error ? err.message : String(err) };
  } finally {
    /* Defensive cleanup: 'pen' variant로 끝난 default 커서를 'thinking'으로
     * 되돌려 다음 도구 호출에 깨끗한 상태를 넘긴다 (rejection 경로 포함). */
    const def = cursorStore.getSnapshot().agents['default'];
    if (def && def.variant === 'pen') {
      cursorStore.updateAgent('default', { variant: 'thinking' });
    }
  }
}
```

### B-3 작성 팁

- **`finally` 블록의 defensive cleanup이 빠지면** rejection 경로에서 default 커서가 'pen' 상태로 남아 다음 도구가 깜빡임을 유발한다.
- **모든 도구는 zod schema로 input 검증**. SDK가 보내는 input은 *대부분* 스키마에 맞지만, 가끔 LLM이 헐떡이는 경우 throw → 자동으로 `{ status: 'failed' }` 응답.
- **도구 메시지 (`message` 필드)는 사용자가 본다**: 짧고 구체적으로. "층고 3.0m → 4.2m" 같이 *변경의 양*을 적시.
- **`parcel_id?` 같은 optional 식별자**: LLM이 종종 빠뜨린다. 미지정 시 active item으로 fallback하면 매번 오류 안 남.

## §B-4. useAgent.ts (도메인 무관, dispatch 타입만 교체)

§7의 코드 그대로. `dispatch`/state 타입만 너의 reducer/store에 맞게 교체. `pendingTools`/`Promise.allSettled`/`fire-and-forget` 부분은 *절대 변경하지 말 것* — Shiva의 본질이 여기 있다.

---

# Part C — 핵심 메커니즘 깊이 (각 모듈)

## 2. 외부 Cursor Store (`lib/cursor-store.ts`)

React 외부에 두는 이유: 마우스 60fps + 동시 N개 트윈은 React 렌더 사이클에 맡기면 끊긴다. 위치는 DOM `transform: translate3d`로 직접 갱신, 메타(label/color/visible/variant)만 `setState`로 알린다.

### 2.1 데이터 모델

```ts
interface CursorState {
  id: string;
  x: number;             // viewport-fixed pixels (clientX/Y)
  y: number;
  visible: boolean;
  label: string;         // 버블 라벨
  color: string;         // hex
  variant: 'pointer' | 'pen' | 'thinking';
}
interface CursorSnapshot {
  user: CursorState;
  agents: Record<string, CursorState>;
}
```

### 2.2 색상 팔레트 (6색)

ad-hoc spawn 용 fallback. **각 역할에는 *고정* 색상이 따로 있다** (ROLES; §3).

```ts
const AGENT_PALETTE = [
  '#E8784B',  // 오렌지 (default)
  '#7B6CD9',  // 보라
  '#3FA88E',  // 청록
  '#D9527B',  // 핑크
  '#C7942A',  // 앰버
  '#5B8DEF',  // 스카이
];
```

> **사용자 색은 `#2D7AF6` (Material blue)** — 에이전트 팔레트와 *채도가 다른 톤*. 사용자가 자기 커서를 즉시 식별 가능해야 한다.

### 2.3 핵심 API

```ts
cursorStore.getSnapshot(): CursorSnapshot
cursorStore.subscribe(fn): () => void
// User
cursorStore.setUser(patch)
// Agents (keyed)
cursorStore.spawnAgent(id, init?)         // 같은 id면 reuse → 깜빡임 X
cursorStore.updateAgent(id, patch)
cursorStore.despawnAgent(id)
cursorStore.despawnAllAgents()             // AGENT_RESET
cursorStore.hideAllAgents()                // visible=false (잔류)
// Settings
cursorStore.getSpeed() / setSpeed(0.5 | 1 | 2 | Infinity)
cursorStore.isFlocking() / setFlocking(boolean)
```

### 2.4 트윈 (`tweenAgent`)

**실제 구현은 Cubic Bezier + 무작위 control points + 미세 jitter**. 단순 `easeOutCubic`이 *완벽한 직선*을 그려서 부자연스럽기 때문.

```ts
/** Cubic Bezier evaluation at parameter t. */
function bezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3;
}

/** 직선 경로에서 살짝 휘는 cubic-Bezier 컨트롤을 무작위로 선정.
 *  85% 같은 쪽, 15% 반대쪽 (간헐적 S-curve). 거리의 8~22% 폭. */
function pickControlPoints(fromX, fromY, toX, toY) {
  const dx = toX - fromX, dy = toY - fromY;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return { c1x: fromX, c1y: fromY, c2x: toX, c2y: toY };
  const px = -dy / dist, py = dx / dist;
  const baseSign = Math.random() < 0.85 ? 1 : -1;
  const m1 = (0.08 + Math.random() * 0.14) * dist * baseSign;
  const m2Sign = Math.random() < 0.7 ? baseSign : -baseSign;
  const m2 = (0.08 + Math.random() * 0.14) * dist * m2Sign;
  return {
    c1x: fromX + dx*0.3 + px*m1,
    c1y: fromY + dy*0.3 + py*m1,
    c2x: fromX + dx*0.7 + px*m2,
    c2y: fromY + dy*0.7 + py*m2,
  };
}

export function tweenAgent(id, targetX, targetY, durationMs): Promise<void> {
  if (!snapshot.agents[id]) return Promise.resolve();
  if (!isFinite(speed) || durationMs <= 0) {
    cursorStore.updateAgent(id, { x: targetX, y: targetY, visible: true });
    return Promise.resolve();
  }
  const dur = durationMs / speed;
  return new Promise((resolve) => {
    let fromX = 0, fromY = 0, c1x = 0, c1y = 0, c2x = 0, c2y = 0;
    let initialized = false, start = 0;
    function frame(now) {
      const live = snapshot.agents[id];
      if (!live) { resolve(); return; }
      if (!initialized) {
        // ★ 첫 프레임에서 from/control 결정 — back-to-back 트윈이 라이브 위치를 줍는다
        fromX = live.x; fromY = live.y;
        const ctrl = pickControlPoints(fromX, fromY, targetX, targetY);
        c1x = ctrl.c1x; c1y = ctrl.c1y; c2x = ctrl.c2x; c2y = ctrl.c2y;
        start = now; initialized = true;
      }
      const t = Math.min(1, (now - start) / Math.max(1, dur));
      const eased = 1 - Math.pow(1 - t, 3);  // easeOutCubic on the bezier param
      let x = bezier(fromX, c1x, c2x, targetX, eased);
      let y = bezier(fromY, c1y, c2y, targetY, eased);
      // 미세 인간 jitter, t=1에 0
      const jitterScale = (1 - t) * 1.5;
      x += (Math.random() - 0.5) * jitterScale;
      y += (Math.random() - 0.5) * jitterScale;
      const flock = flockingOffset(id, x, y, t);   // optional (§2.6)
      x += flock.dx; y += flock.dy;
      cursorStore.updateAgent(id, { x, y, visible: true });
      if (t < 1) requestAnimationFrame(frame);
      else {
        cursorStore.updateAgent(id, { x: targetX, y: targetY, visible: true });
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}
```

**Fitts' Law-스타일 duration**: 거리 기반 자연스러운 시간.

```ts
export function fittsDuration(fromX, fromY, toX, toY): number {
  const dist = Math.hypot(toX - fromX, toY - fromY);
  const t = 80 + 200 * Math.log2(dist / 14 + 1);   // target_size=14px
  return Math.max(120, Math.min(900, t));   // 120~900ms 클램프
}
```

### 2.5 속도 컨트롤

`localStorage('<app>.agentCursorSpeed')` 영속화. 4-step preset.

| Preset | speed 값 | 의도 |
|--------|---------|------|
| 0.5×   | 0.5     | 시연/녹화 (천천히) |
| 1×     | 1       | 기본 |
| 2×     | 2       | 빠르게 |
| ⏭      | Infinity | 애니메이션 스킵 (즉시 dispatch) |

`Infinity`로 설정하면 트윈 RAF 루프를 우회 → 비주얼 없이 reducer만 실행. **자동화 테스트(Playwright)에서 그대로 쓸 수 있다.**

### 2.6 플로킹 (옵션) — Boids 분리력

여러 커서가 같은 영역에 몰릴 때 부드럽게 비켜가는 효과. **t=1 (도착)에서 force=0**이 되도록 falloff → 정확히 타겟에 안착.

```ts
function flockingOffset(selfId, curX, curY, t): { dx, dy } {
  if (!flockingEnabled) return { dx: 0, dy: 0 };
  const RADIUS = 90;
  const STRENGTH = 8000;
  let sx = 0, sy = 0;
  for (const [id, c] of Object.entries(snapshot.agents)) {
    if (id === selfId || !c.visible) continue;
    const dx = curX - c.x, dy = curY - c.y;
    const d2 = dx*dx + dy*dy;
    if (d2 < 1 || d2 > RADIUS*RADIUS) continue;
    sx += dx / d2; sy += dy / d2;
  }
  const falloff = Math.max(0, 1 - t);
  return { dx: sx * STRENGTH * falloff, dy: sy * STRENGTH * falloff };
}
```

**판단 기준**: 도구 6개 이상이 동시에 캔버스 같은 좁은 영역에 모이는 시나리오가 자주 있으면 ON 기본값 검토. 그 외는 OFF가 안정적.

### 2.7 localStorage 가드

테스트(jsdom)·시크릿 모드·sandboxed iframe에서 `window.localStorage` 접근이 throw → 반드시 try/catch:

```ts
function safeGet(key) {
  try { return typeof window !== 'undefined' && window.localStorage
    ? window.localStorage.getItem(key) : null; } catch { return null; }
}
function safeSet(key, value) {
  try { if (typeof window !== 'undefined' && window.localStorage)
    window.localStorage.setItem(key, value); } catch { /* swallow */ }
}
```

---

## 3. 역할 기반 안정 ID (Shiva 모델)

### 3.1 역할 카탈로그 — *너의 도메인이 결정한다*

`agent/tool-executor.ts`에서 정의. **각 역할은 한 영역만 담당**하고, 같은 역할의 도구가 반복 호출되면 *같은 cursor id*를 재사용한다.

```ts
const ROLES = {
  // 형식: <key>: { label: '<버블 라벨>', color: '<hex>' }
  // 예시 (§3.3 가이드를 보고 너의 도메인으로):
  // builder:      { label: '도형',     color: '#E8784B' },
  // tunerA:       { label: '<tunerA>', color: '#7B6CD9' },
  // ...
} as const;
```

### 3.2 안정 cursor ID 매핑

```
'default'          ← 메인 작업 커서 (보통 builder 역할)
'<roleA-instance>' ← 역할 인스턴스. 역할 1개당 1개 또는 컨트롤마다 1개.
                     (예: 'tuner-floor', 'tuner-max'는 같은 역할 다른 컨트롤)

// 임시 multi-cursor (한 도구 안에서 N개 spawn)
'aux-0', 'aux-1', 'aux-2', ..., 'checker'
```

같은 cursor id를 `spawnAgent`하면 **기존 위치 유지**한 채 라벨/색만 갱신 → 시각적 깜빡임 없음.

### 3.3 역할 디자인 가이드 (도메인에 적용)

너의 앱에 ROLES를 정의할 때:

1. **UI를 *작업 영역*으로 분류**: "사이드바 슬라이더 그룹A", "캔버스 도형 편집", "리스트 칩 선택", "채팅 패널 카드" 등 사람이 한 손으로 다룰 만한 단위로.
2. **각 영역에 역할 1개**: 한 역할이 여러 도구를 가질 수 있다 (e.g., `builder`가 draw/move/translate 모두 담당).
3. **색은 6색 팔레트에서 충돌 없이**: 사람이 *한눈에 구분*할 수 있는 만큼만. 더 필요하면 색을 늘리지 말고 변형(stripe/dashed)을 검토.
4. **레이블은 한 단어 + 1~3자**: 버블이 좁다 (`층고`, `최대높이`, `선택`, `제안`).
5. **역할이 너무 많으면 통합**: 사용자가 "각 색이 무슨 의미인지" 기억 못 하면 실패. 4~6 역할이 한계.

### 3.4 잔류 정책 (Persistence policy)

- 작업 완료 후 → `variant: 'thinking'`으로 변경하고 *그 자리에 머문다*.
- 다음 도구 호출 시 → 같은 ID로 다시 `spawnAgent`되며 *현재 위치에서* 새 타겟으로 트윈 시작 (Fitts 거리 자연스럽게 짧음).
- 사용자 채팅 "초기화" → `AGENT_RESET` dispatch → `cursorStore.despawnAllAgents()`.
- 새 turn 시작 → `default` 커서를 채팅 패널 헤더 좌측에 spawn.

### 3.5 임시 multi-cursor (aux 패턴)

한 도구 *안에서* 여러 위치를 동시 조작해야 할 때:

- **임시**: `aux-0`, `aux-1`, ..., `checker` 같은 비-역할 ID로 spawn.
- **사용 후 despawn**: 한 도구가 끝나면 정리. *역할 커서*(재사용)와 다른 정책.

```ts
// 도구 시작
cursorStore.spawnAgent('aux-0', { label: 'A1', color: '#7B6CD9', variant: 'pen' });
cursorStore.spawnAgent('aux-1', { label: 'A2', color: '#5B8DEF', variant: 'pen' });
cursorStore.spawnAgent('checker', { label: '✓',  color: '#3FA88E', variant: 'thinking' });
// ... 작업 ...
// 도구 끝
cursorStore.despawnAgent('aux-0');
cursorStore.despawnAgent('aux-1');
cursorStore.despawnAgent('checker');
```

---

## 4. UI Registry — 좌표 발견 패턴

에이전트 커서가 슬라이더 thumb 위로 가려면 *그 슬라이더의 화면 좌표*를 알아야 한다. 컴포넌트가 `useEffect`로 자기 DOMRect getter를 등록, 도구 실행기는 글로벌 registry에서 ID로 조회.

### 4.1 Registry (`lib/ui-registry.ts`)

```ts
type RectGetter = () => DOMRect | null;
const registry = new Map<string, RectGetter>();

export const uiRegistry = {
  register(id, getter) {
    registry.set(id, getter);
    return () => { if (registry.get(id) === getter) registry.delete(id); };
  },
  getRect(id): DOMRect | null { return registry.get(id)?.() ?? null; },
  has(id): boolean { return registry.has(id); },
};

// ★ 도메인별로 채운다
export const UI_IDS = {
  SLIDER_PARAM_A: 'slider-param-a',
  SLIDER_PARAM_B: 'slider-param-b',
  SELECT_CATEGORY: 'select-category',
  itemChip: (id: string) => `item-chip-${id}`,
} as const;

export function sliderThumbX(rect, value, min, max): number {
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return rect.left + rect.width * t;
}
```

### 4.2 컴포넌트 등록 패턴

```tsx
function SliderInput({ value, min, max, onChange, registerId }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!registerId) return;
    return uiRegistry.register(registerId,
      () => ref.current?.getBoundingClientRect() ?? null);
  }, [registerId]);
  return <input ref={ref} type="range" ... />;
}
// 사용: <SliderInput registerId={UI_IDS.SLIDER_PARAM_A} ... />
```

**핵심 원칙**:
- `register` 반환값은 cleanup 함수 → useEffect cleanup으로 자동 제거.
- getter는 *함수*다. DOMRect를 등록 시점에 캡처하지 말 것 (스크롤/리사이즈 시 다름).
- 동일 ID 재등록 시 새 getter로 교체. cleanup은 *자기 getter일 때만* 삭제 (ref 비교).

### 4.3 SliderThumbX 계산

슬라이더 입력의 `getBoundingClientRect()`는 **트랙 전체** 사각형이다. value가 `min~max`일 때 thumb의 X는:

```
thumbX = rect.left + rect.width * (value - min) / (max - min)
```

이를 모르고 `rect.left + rect.width / 2` 같은 중앙으로 가면 *값과 cursor 위치가 어긋나는* 어색한 경험.

---

## 5. `operateUIElement` — 핵심 헬퍼

도구 실행기가 사이드바/칩을 다룰 때 모두 이 함수를 거친다. **spawn-or-reuse → travel → pause → apply → park**의 5단계 의식.

§B-3 템플릿 참조. 호출 예시:

### 5.1 슬라이더 (단일 dispatch)

```ts
case 'set_floor_height': {
  const parsed = setFloorHeightSchema.parse(input);
  await operateUIElement(
    'tuner-floor',
    UI_IDS.SLIDER_FLOOR_HEIGHT,
    'tunerFloor',
    () => ctx.dispatch({ type: 'SET_SUNLIGHT', params: { floorHeight: parsed.meters } }),
    { targetX: (rect) => sliderThumbX(rect, parsed.meters, 2.5, 5) },
  );
  return { status: 'applied', message: `층고 ${parsed.meters}m` };
}
```

### 5.2 칩 × 버튼 (영역 안 특정 좌표)

```ts
await operateUIElement(
  'picker',
  UI_IDS.parcelChip(args.parcel_id),
  'picker',
  () => ctx.dispatch({ type: 'DELETE_PARCEL', id: args.parcel_id }),
  { targetX: (rect) => rect.right - 9 },   // × 버튼은 칩 오른쪽 끝
);
```

---

## 5b. 점진적 동작 (Progressive operations)

**관찰**: 사용자는 *결과 값*보다 *변화 과정*을 신뢰한다. 단일 dispatch (값이 한 프레임에 점프)는 마법처럼 보이지만 *과정*이 없어 의심을 사기 쉽다.

→ 슬라이더, 꼭짓점 이동, 회전, 평행이동 같은 *연속 변형*은 N단계 micro-step으로 분할 dispatch한다.

### 5b.1 progressiveSlider (다단계 드래그)

§B-3 §4 템플릿 참조. 핵심:

- 시작은 **현재 값 위치**로 cursor를 보내서 thumb를 "잡는" 모션.
- N단계 (기본 10) 동안 매 step마다:
  1. `tweenAgent`로 cursor를 다음 position으로 70ms 트윈.
  2. `apply(intermediate_value)`로 reducer dispatch.
  3. step 사이 30~50ms `sleep` (끝으로 갈수록 짧게).

이 패턴이 적용되면 사용자는 *슬라이더가 슬라이드하는 동시에 3D 뷰어가 실시간으로 따라간다*. 시각적으로 가장 강한 신뢰 신호.

### 5b.2 progressiveVertex (꼭짓점 드래그)

```ts
const dist = Math.hypot(target[0] - startV[0], target[1] - startV[1]);
const steps = Math.max(1, Math.min(8, Math.round(dist)));   // ~1m/step, capped 1–8
for (let i = 1; i <= steps; i++) {
  const t = i / steps;
  const interp = [
    startV[0] + (target[0] - startV[0]) * t,
    startV[1] + (target[1] - startV[1]) * t,
  ];
  await moveCursorTo('default', interp, ctx);
  ctx.dispatch({ type: 'MOVE_VERTEX', idx, point: interp });
  await sleep(60);
}
```

### 5b.3 iterative scale_to_area (인간 같은 정제)

목표를 *한 번에* 맞추는 대신, 매 iteration에서 1~2개 꼭짓점을 무작위로 골라 약간 이동, 면적 재측정, 목표와 비교, 0.5% 이내 도달까지 최대 14회 반복. 별도 `checker` 커서가 centroid에 머물며 "면적 측정 중" 인상.

```ts
const MAX_ITER = 14, TOLERANCE = 0.005;
for (let iter = 0; iter < MAX_ITER; iter++) {
  const verts = getCurrentVerts();
  const area = polygonArea(verts);
  const error = (target - area) / target;
  if (Math.abs(error) < TOLERANCE) break;

  const i0 = randomVertex(), i1 = randomVertex(); // 중복 회피
  const stepAggression = 0.5;
  const cappedStep = Math.max(-0.25, Math.min(0.25, error * stepAggression));

  // 무작위 picks를 cursor가 동시에 잡고 → centroid ray로 약간 끌어당김 → dispatch
  await Promise.all(picks.map((idx, j) => moveCursorTo(`aux-${j}`, verts[idx], ctx)));
  await sleep(110);
  const newVerts = applyStep(verts, picks, cappedStep);
  await Promise.all(picks.map((idx, j) => moveCursorTo(`aux-${j}`, newVerts[idx], ctx)));
  ctx.dispatch({ type: 'SET_VERTICES', vertices: newVerts });
  await sleep(120);
}
```

이 패턴은 LLM이 한 번에 수렴하기 어려운 *수치 목표*에 특히 강하다 (비율, 면적, 길이...). 시스템 프롬프트에서 "한 번에 끝내지 말고 client가 자동 정제한다"고 LLM에게 가르쳐야 한다.

### 5b.4 progressiveSlider/rotate/translate에서 race 회피

연속 step에서 *같은 cursor id*에 RAF tween을 백그라운드로 돌리고 다음 iteration이 또 RAF tween을 등록하면 — 두 tween이 같은 cursor의 x/y를 race한다.

→ **각 iteration의 step은 `await tweenAgent(...)` (Promise resolve)** 이후 `apply()` 호출. 다음 iteration이 새 tween을 시작할 때 *이전 tween은 끝나 있다*. 또는 즉시 위치를 갱신해야 한다면 `cursorStore.updateAgent({ x, y })` 직접 호출 (translate centroid 추적의 경우).

---

## 6. Cursor Overlay — 외부 store ↔ DOM

`components/CursorOverlay.tsx`는 store 구독을 React 렌더와 분리. 핵심: **위치는 transform으로 직접, 메타만 setState**.

```tsx
function CursorView({ getCursor, subscribe, kind }) {
  const dotRef = useRef<HTMLDivElement>(null);
  const [meta, setMeta] = useState(() => {
    const c = getCursor();
    return c ? { visible: c.visible, label: c.label, variant: c.variant, color: c.color } : null;
  });

  useEffect(() => {
    const apply = () => {
      const c = getCursor();
      if (!c) { setMeta(null); return; }
      // ★ Position: bypass React, write DOM directly
      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${c.x}px, ${c.y}px, 0)`;
      }
      // ★ Meta: setState only when actually changed
      setMeta((prev) =>
        prev && prev.visible === c.visible && prev.label === c.label
          && prev.variant === c.variant && prev.color === c.color
          ? prev : { visible: c.visible, label: c.label, variant: c.variant, color: c.color });
    };
    apply();
    return subscribe(apply);
  }, [getCursor, subscribe]);

  // meta 변경으로 re-render 후 transform 재적용 (translate3d(0,0,0)로 깜빡 방지)
  useLayoutEffect(() => {
    const c = getCursor();
    if (!c || !dotRef.current) return;
    dotRef.current.style.transform = `translate3d(${c.x}px, ${c.y}px, 0)`;
  }, [meta, getCursor]);

  return (
    <div ref={dotRef} className={`cursor-overlay cursor-overlay-${kind} ${meta?.visible ? 'is-visible' : ''} cursor-variant-${meta?.variant}`} aria-hidden>
      {meta && (
        <>
          <svg className="cursor-arrow" width="20" height="22" viewBox="0 0 20 22" fill="none">
            <path d="M2 2 L2 16.5 Q2 17.6 3 17.1 L6.5 14.7 L9.6 20 Q10 20.6 10.7 20.3 L11.7 19.8 Q12.4 19.5 12.0 18.8 L8.9 13.4 L13.5 12.5 Q14.5 12.3 13.7 11.6 Z"
              fill={meta.color} stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
          <span className="cursor-ripple" style={{ borderColor: meta.color }} />
          {meta.label && (
            <span className="cursor-bubble" style={{ background: meta.color }}>
              <span className="cursor-bubble-dot" />
              {meta.label}
            </span>
          )}
        </>
      )}
    </div>
  );
}
```

### 6.1 라이프 — `<CursorLayer />`

```tsx
export default function CursorLayer() {
  const [agentIds, setAgentIds] = useState(() => Object.keys(cursorStore.getSnapshot().agents));
  useEffect(() => cursorStore.subscribe(() => {
    const next = Object.keys(cursorStore.getSnapshot().agents);
    setAgentIds(prev =>
      prev.length === next.length && prev.every((id, i) => id === next[i]) ? prev : next);
  }), []);
  return (
    <>
      <CursorView kind="user" getCursor={() => cursorStore.getSnapshot().user} subscribe={cursorStore.subscribe} />
      {agentIds.map(id => (
        <CursorView key={id} kind="agent"
          getCursor={() => cursorStore.getSnapshot().agents[id] ?? null}
          subscribe={cursorStore.subscribe} />
      ))}
    </>
  );
}
```

### 6.2 사용자 커서 추적 (`useUserCursorTracking`)

```ts
export function useUserCursorTracking(label = '나') {
  useEffect(() => {
    let pending: number | null = null;
    let lastX = 0, lastY = 0;
    cursorStore.setUser({ label, variant: 'pointer', color: '#2D7AF6' });
    const flush = () => {
      pending = null;
      cursorStore.setUser({ x: lastX, y: lastY, visible: true });
    };
    const onMove = (e: MouseEvent) => {
      lastX = e.clientX; lastY = e.clientY;
      if (pending == null) pending = requestAnimationFrame(flush);  // RAF 스로틀
    };
    const onLeave = () => cursorStore.setUser({ visible: false });
    const onEnter = () => cursorStore.setUser({ visible: true });
    window.addEventListener('mousemove', onMove);
    document.addEventListener('mouseleave', onLeave);
    document.addEventListener('mouseenter', onEnter);
    return () => {
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
      document.removeEventListener('mouseenter', onEnter);
      if (pending != null) cancelAnimationFrame(pending);
    };
  }, [label]);
}
```

루트 레이아웃에서 한 번 호출. (§A-5 참조)

---

## 7. 동시 실행 — `useAgent.ts`의 fire-and-forget

이게 Shiva의 *진짜 비밀*. await 한 줄을 빼느냐 마느냐로 비주얼이 시퀀셜이냐 병렬이냐가 갈린다.

```ts
'use client';
import { useCallback, useEffect, useRef } from 'react';
import { parseSseStream } from '@/lib/sse-parser';
import { executeTool, type ExecutorContext } from '@/agent/tool-executor';

export function useAgent(getExecutorContext: () => ExecutorContext) {
  const { state, dispatch } = useAppStore();          // 도메인별
  // ★ Live state ref — 비동기 콜백이 항상 최신 state를 본다.
  // 매 render마다 send를 새로 만들지 않으면서도 stale closure 회피.
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async (userText: string) => {
    const live = stateRef.current;
    if (live.agentInFlight) return;
    const userMsgId = nextId('u');
    const assistantMsgId = nextId('a');

    dispatch({ type: 'AGENT_USER_MESSAGE', id: userMsgId, content: userText });
    dispatch({ type: 'AGENT_ASSISTANT_START', id: assistantMsgId });

    const summary = summarizeAppState(live);   // 도메인별 state 요약
    const messages = [...live.conversation, { role: 'user', content: userText }];
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages, appState: summary }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '');
        dispatch({ type: 'AGENT_ERROR', message: errText || `HTTP ${res.status}` });
        return;
      }

      const toolBuffers = new Map<string, { id: string; name: string }>();
      // ★ 한 응답의 tool_use는 동시 실행. AGENT_DONE은 모든 sub-agent의 애니메이션
      // + dispatch가 끝난 뒤에 발화.
      const pendingTools = new Set<Promise<void>>();

      for await (const evt of parseSseStream(res.body)) {
        const data = evt.data as Record<string, unknown>;
        switch (evt.event) {
          case 'text_delta':
            dispatch({ type: 'AGENT_ASSISTANT_DELTA', id: assistantMsgId, text: String(data.text ?? '') });
            break;
          case 'tool_use_start':
            toolBuffers.set(String(data.id), { id: String(data.id), name: String(data.name) });
            dispatch({ type: 'AGENT_TOOL_RECORD', messageId: assistantMsgId,
              tool: { id: String(data.id), name: String(data.name), input: null, status: 'pending' } });
            break;
          case 'tool_use_end': {
            const id = String(data.id);
            const buf = toolBuffers.get(id);
            if (!buf) break;
            toolBuffers.delete(id);
            // ★★★ FIRE-AND-FORGET — 절대 여기서 await 하지 말 것!
            const p = (async () => {
              const result = await executeTool(buf.name, data.input, getExecutorContext());
              if (ctrl.signal.aborted) return;   // 중단 시 dispatch skip
              dispatch({ type: 'AGENT_TOOL_UPDATE', messageId: assistantMsgId, toolId: id,
                patch: { input: data.input, status: result.status, message: result.message } });
            })();
            pendingTools.add(p);
            p.finally(() => pendingTools.delete(p));
            break;
          }
          case 'error':
            dispatch({ type: 'AGENT_ERROR', message: String(data.message ?? 'unknown error') });
            return;
          case 'done':
            break;
        }
      }
      // 모든 sub-agent 애니메이션이 끝날 때까지 대기 후 AGENT_DONE
      await Promise.allSettled(pendingTools);
      dispatch({ type: 'AGENT_DONE' });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        dispatch({ type: 'AGENT_DONE' });
      } else {
        dispatch({ type: 'AGENT_ERROR', message: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      abortRef.current = null;
    }
  }, [dispatch, getExecutorContext]);

  const cancel = useCallback(() => { abortRef.current?.abort(); }, []);
  return { send, cancel };
}
```

### 7.1 왜 Promise.allSettled?

- `Promise.all`은 하나라도 throw하면 나머지를 *기다리지 않고* 스킵 → 일부 커서가 화면에 멈춰버린다.
- 각 도구는 자체적으로 try/catch (executor가 status: 'failed' 반환) → reject 거의 없지만, 안전하게 `allSettled`.

### 7.2 reducer 슬라이스 분리 (race 회피)

동시 dispatch가 안전하려면 reducer slice가 *독립*이어야 한다.

```
초기 버그 (이 레포 사례):
  SET_ZONE이 zone-preset에서 maxHeight도 덮어썼다.
  → set_zone + set_max_height 동시 호출 시 race
  → set_zone이 나중에 도착하면 max_height가 사라짐.

수정:
  SET_ZONE은 zoneType과 setback ratio만 변경.
  maxHeight는 별도 사용자/도구 의도로만 변경 (별 슬라이스).
```

**일반 원칙**: 도구를 동시 호출 가능하게 디자인하려면, 각 도구의 영향 범위가 reducer state에서 *서로 다른 키*여야 한다. 같은 키를 두 도구가 건드리면 마지막 dispatch가 이긴다 (race).

### 7.3 의존 작업 처리

`duplicate_parcel` 후 새로 생긴 ID에 `scale_to_area`를 쓰려면? 새 ID는 *클라가 만든 후 reducer에 들어간다*. 같은 turn에서는 LLM이 이 ID를 모른다.

→ **두 turn으로 분리**. 시스템 프롬프트가 "<X 후 새 ID 사용은 다음 응답으로>"라고 명시.

이 문서를 쓸 때 의존 작업이 있으면 다음 turn으로 분리하는 정책을 LLM에게 가르쳐야 한다 (§B-1 참조).

### 7.4 Live state ref (stale closure 회피)

`useCallback`의 deps에 `state`를 넣으면 매 render마다 `send` 새로 생성 → 자식이 props로 받으면 무한 루프 위험. 안 넣으면 stale closure.

→ `useRef`로 mirror하고 `useEffect`로 매 render마다 갱신: `stateRef.current` 항상 최신.

---

## 8. 서버 — Anthropic Agent SDK + In-Process MCP

§B-2 템플릿 참조. 추가 노트:

### 8.1 In-process MCP 서버

```ts
const myServer = createSdkMcpServer({
  name: MCP_SERVER_NAME,
  alwaysLoad: true,                    // turn 시작에 항상 로드
  tools: [
    tool('<name>', '<description>',
      { /* zod schema */ },
      // ★ 핸들러는 ack만. 실제 실행은 클라가.
      async (a) => ({ content: [{ type: 'text', text: `[ack ${...}]` }] }),
    ),
  ],
});
```

**왜 핸들러가 ack만?** 진짜 동작(reducer dispatch + cursor 애니메이션)은 *DOM이 있는 브라우저*에서만 가능. 서버는 LLM에게 "이 호출은 받았다"고 알리는 역할.

### 8.2 SSE 스트리밍

§B-2의 route.ts 그대로. 핵심 흐름:
- `stream_event` `content_block_start` → `tool_use_start` (id, name 통보).
- `stream_event` `content_block_delta` `text_delta` → `text_delta` (어시스턴트 자연어).
- `assistant` 메시지 (확정된 input) → `tool_use_end` (id, name, input).
- `result` → `done` 또는 `error`.

### 8.3 Tool input race 함정

`stream_event`의 `content_block_delta`로 오는 `input_json_delta`는 **여러 tool_use가 병렬일 때 인터리브**된다. 즉, accumulator에 단순 concat하면 JSON이 깨진다.

→ **delta는 무시**하고 `assistant` 메시지의 `block.input` (이미 파싱된 객체)만 사용:

```ts
} else if (m.type === 'assistant') {
  const content = m.message?.content ?? [];
  for (const block of content) {
    if (block.type === 'tool_use' && !emittedToolEnds.has(block.id)) {
      send('tool_use_end', { id: block.id, name, input: block.input ?? {} });
      emittedToolEnds.add(block.id);
    }
  }
}
```

### 8.4 클라이언트 SSE 파싱

```ts
export interface SseEvent { event: string; data: unknown; }

export async function* parseSseStream(body): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const evt = parseChunk(chunk);
        if (evt) yield evt;
      }
    }
    if (buffer.trim()) {
      const evt = parseChunk(buffer);
      if (evt) yield evt;
    }
  } finally { reader.releaseLock(); }
}

function parseChunk(chunk: string): SseEvent | null {
  const lines = chunk.split('\n');
  let eventName = 'message';
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  const raw = dataLines.join('\n');
  try { return { event: eventName, data: JSON.parse(raw) }; }
  catch { return { event: eventName, data: raw }; }
}
```

### 8.5 `result.is_error` 처리

SDK는 **"성공 응답이지만 사실은 거부 텍스트"**인 경우가 있다 (`subtype='success'` & `is_error=true`). 둘 다 error로 취급해서 사용자에게 깨끗한 메시지를 보여주는 게 안전:

```ts
} else if (m.type === 'result') {
  const isError =
    m.subtype !== 'success' ||
    ('is_error' in m && m.is_error === true);
  const text = 'result' in m ? m.result : null;
  if (isError) {
    const message = text
      ?? ('errors' in m && m.errors?.length ? m.errors.join('; ') : `agent ${m.subtype}`);
    send('error', { message });
  } else send('done', { result: text });
  break;
}
```

---

## 9. 시스템 프롬프트 (태스크 매니저 메타포)

LLM이 "한 응답에 도구 여러 개를 발행해도 좋다"는 걸 *이해해야* 동시성이 살아난다.

§B-1 템플릿 참조. 이 레포의 *실제* 프롬프트(`5.0.0-progressive`)는 §14의 파일 매핑에서 확인 가능.

### 9.1 디자인 상태 자동 첨부

매 turn 사용자 메시지 앞에 현재 state 요약 JSON이 붙는다. LLM이 `get_<state>`를 매번 부르지 않게 하려는 토큰 절약.

```ts
function formatPrompt(req): string {
  const stateBlock =
    `[현재 상태 — prompt-version=${PROMPT_VERSION}]\n` +
    '```json\n' + JSON.stringify(req.appState, null, 2) + '\n```';
  // ... 이전 대화 + 새 사용자 메시지와 결합
}
```

### 9.2 Versioning

```ts
export const PROMPT_VERSION = '<major>.<minor>.<patch>-<descriptor>';
```

프롬프트는 코드와 같이 진화한다. 버전 명시 → 텔레메트리에서 어느 prompt가 어떤 결과를 냈는지 역추적 가능.

이 레포의 이력 (참고):
- `1.0.0-N1` 초기
- `2.0.0-N2` 다중 필지 + "절대 처음부터 다시 그리지 말 것"
- `3.0.0-shiva` 역할별 커서 + 잔류
- `4.0.0-taskmanager` 매니저 메타포 + 병렬 명시
- `5.0.0-progressive` 점진적 동작 (자동 정제 / 다단계 슬라이더 드래그)

### 9.3 도메인 적응 가이드

너의 시스템 프롬프트가 다음 4개를 포함하면 *Shiva가 살아난다*:

1. **태스크 매니저 메타포 한 단락** — "당신은 매니저, 도구는 서브 에이전트. 한 명은 한 가지." (§B-1 그대로 쓰면 됨)
2. **서브 에이전트 카탈로그 표** — 도구 ↔ 라벨/색 매핑. LLM이 어떤 색이 어떤 영역에서 일하는지 *읽어야* 한 응답에 여러 색을 동시에 띄울 수 있다는 걸 *학습*한다.
3. **독립/의존 예시 쌍** — 너의 도메인에서 가장 흔한 "병렬 가능" 시나리오 1개 + "분리 필요" 시나리오 1개.
4. **점진적 동작 명시** — "X 도구는 클라가 자동으로 점진 처리. 같은 도구 여러 번 부르지 마라." (점진적 패턴을 쓰는 도구가 있을 때만)

---

## 10. 디자인 시스템 (커서 영역)

### 10.1 커서 SVG — Figma/Docs 스타일 화살표

```html
<svg className="cursor-arrow" width="20" height="22" viewBox="0 0 20 22" fill="none">
  <path
    d="M2 2 L2 16.5 Q2 17.6 3 17.1 L6.5 14.7 L9.6 20 Q10 20.6 10.7 20.3
       L11.7 19.8 Q12.4 19.5 12.0 18.8 L8.9 13.4 L13.5 12.5
       Q14.5 12.3 13.7 11.6 Z"
    fill={color} stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
</svg>
```

**둥근 corners (Q-curves) + 흰색 1.4px 스트로크**가 핵심. 그림자는 CSS:

```css
.cursor-arrow {
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.18));
}
```

### 10.2 라벨 버블 (Figma multiplayer 스타일)

```css
.cursor-bubble {
  margin-top: 18px; margin-left: 4px;
  padding: 3px 10px 3px 6px;
  font-size: 11px; font-weight: 600;
  color: #fff;
  border-radius: 10px;
  white-space: nowrap;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.22);
  display: inline-flex; align-items: center; gap: 5px;
  transition: transform 140ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.cursor-bubble-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.35);
  animation: cursor-presence 2.2s ease-in-out infinite;
}
@keyframes cursor-presence {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.55; }
}
```

`cursor-bubble-dot`이 부드럽게 깜빡 → "live presence" 신호.

### 10.3 Variant 애니메이션

```css
/* 'thinking' — 잔류 시 위아래로 살짝 호흡 */
.cursor-variant-thinking .cursor-arrow {
  animation: cursor-thinking 2.4s ease-in-out infinite;
}
@keyframes cursor-thinking {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-1.5px); }
}

/* 'pen' — 작업 중 활기차게 흔들림 */
.cursor-variant-pen .cursor-arrow {
  animation: cursor-pen-bob 0.9s ease-in-out infinite;
}
@keyframes cursor-pen-bob {
  0%, 100% { transform: translateY(0) rotate(-2deg); }
  50%      { transform: translateY(1px) rotate(2deg); }
}

/* Click ripple — pen variant에서만 표시 */
.cursor-variant-pen .cursor-ripple {
  animation: cursor-ripple 1.2s ease-out infinite;
}
@keyframes cursor-ripple {
  0%   { opacity: 0.7; transform: translate(-50%, -50%) scale(0.4); }
  80%  { opacity: 0;   transform: translate(-50%, -50%) scale(2.2); }
  100% { opacity: 0;   transform: translate(-50%, -50%) scale(2.2); }
}
```

### 10.4 Z-stack & Pointer

```css
.cursor-overlay {
  position: fixed;
  top: 0; left: 0;
  pointer-events: none;     /* ★ 절대 마우스 이벤트 가로채지 말 것 */
  z-index: 9999;
  opacity: 0;
  transition: opacity 200ms ease;
  will-change: transform;   /* GPU 레이어 분리 */
}
.cursor-overlay.is-visible { opacity: 1; }
.cursor-overlay-user  { z-index: 9998; }   /* 사용자는 에이전트 아래 */
.cursor-overlay-agent { z-index: 9999; }
```

### 10.5 사용자 vs 에이전트 색

| 역할 | 색 | 사용 |
|------|----|------|
| 사용자 커서 | `#2D7AF6` | 실제 마우스 (Material blue) |
| 에이전트 default | `#E8784B` | 오렌지 — primary brand accent (이 레포) |
| 에이전트 슬라이더A | `#7B6CD9` | 보라 |
| 에이전트 슬라이더B | `#3FA88E` | 청록 |
| 에이전트 select   | `#5B8DEF` | 스카이 (사용자 파랑과 채도 차이) |
| 에이전트 picker   | `#D9527B` | 핑크 |
| 에이전트 proposer | `#C7942A` | 앰버 |

> **이 색은 이 레포의 *예시*다.** 너의 브랜드/도메인 톤에 맞게 §3.3의 가이드에 따라 재정의. 단 *사용자 색은 다른 모든 색과 채도/명도가 명확히 다른 톤*을 유지.

### 10.6 접근성

```tsx
<div className="sr-only" aria-live="polite" aria-atomic="true">
  {liveAnnouncement}
</div>
```

도구 호출 결과를 짧은 문구로 ARIA live region에 발화:

```ts
setLiveAnnouncement(
  `${TOOL_LABELS[lastTool.name] ?? lastTool.name} ${
    lastTool.status === 'applied' ? '완료' : lastTool.status
  }${lastTool.message ? `: ${lastTool.message}` : ''}`
);
```

**원칙**: 커서 애니메이션은 시각 정보다. 시각 장애 사용자에게 동등한 정보가 가야 한다.

---

# Part D — 운영

## §D-1. 자주 빠지는 함정 (포팅 시 1순위 점검)

| 함정 | 결과 | 해결 |
|------|------|------|
| `tool_use_end`에서 `await executeTool` | 도구가 직렬 실행 → 비주얼 시퀀셜 | fire-and-forget + `pendingTools.add` (§7) |
| `input_json_delta` accumulator로 input 조립 | 병렬 도구일 때 JSON 깨짐 | 무시 + assistant `block.input` 사용 (§8.3) |
| 같은 reducer 키를 두 도구가 건드림 | race로 한쪽 사라짐 | reducer slice 분리 또는 시스템 프롬프트 (§7.2) |
| 도구마다 새 cursor id로 spawn | 깜빡임 | 역할별 안정 ID 재사용 (§3.2) |
| 작업 후 즉시 despawn | 누가 뭘 했는지 사라짐 | `variant: 'thinking'`로 잔류, AGENT_RESET에서만 정리 (§3.4) |
| `pointer-events: auto` on overlay | 사용자 클릭 가로챔 | **반드시** `pointer-events: none` (§10.4) |
| DOMRect를 등록 시점에 캡처 | 스크롤/리사이즈 후 어긋남 | getter 함수로 등록, 매번 호출 (§4.1) |
| `localStorage` 직접 호출 | jsdom·sandboxed iframe에서 throw | safeGet/safeSet 가드 (§2.7) |
| Promise.all로 도구 대기 | 하나 reject 시 나머지 미정리 | `Promise.allSettled` (§7.1) |
| 슬라이더 중앙 클릭 | 값과 cursor 위치 어긋남 | `sliderThumbX(rect, value, min, max)` (§4.3) |
| 같은 cursor에 RAF tween 중첩 | x/y race로 떨림 | `await tweenAgent` 후 다음 step, 또는 직접 `updateAgent` (§5b.4) |
| `finally` cleanup 빠짐 | rejection 시 'pen' 잔존 → 다음 도구 깜빡임 | dispatcher `finally`에서 'thinking'으로 복귀 (§B-3 §6) |
| `result.is_error` 처리 누락 | success 응답에 거부 메시지가 채팅에 누출 | `subtype !== 'success' \|\| is_error === true`로 error 처리 (§8.5) |
| `useCallback` deps에 state 포함 | 매 render마다 send 재생성 | `stateRef.current` mirror 패턴 (§7.4) |

## §D-2. 검증 시나리오 (Playwright 자동화 가능)

이 패턴이 살아있는지 확인하는 6개 도메인-무관 시나리오:

| # | 의도 | 기대 비주얼 |
|---|------|-----------|
| S1 | 단일 작업 ("X 만들어줘") | default 커서가 캔버스 위 N점을 차례로 찍는다 |
| S2 | 독립 3 작업 동시 | 다른 색 3개 커서가 *동시에* 사이드바로 향한다 |
| S3 | 다중 좌표 동시 조작 | aux-N N개 커서가 *동시에* N개 위치를 끌어당긴다 |
| S4 | 동일 도구 다회 호출 | default 커서가 위치를 차례로 점프, 마지막에 잔류 |
| S5 | 점진적 변형 | cursor가 N단계로 끌어당기며 state가 부드럽게 변함 |
| S6 | 의존 작업 (활성 전환 후 작업) | picker → builder 두 turn에 걸쳐 진행 |

`speed = Infinity` 모드로 실행하면 비주얼 없이 reducer만 검증 가능 → CI E2E 테스트에 적합.

## §D-3. 텔레메트리 후크 포인트 (옵션)

운영 시 이런 메트릭이 유용:
- 도구 호출 빈도 (turn당 평균 N개) → 매니저 메타포 효과 측정
- 사용자 "중단" 클릭 비율 → cursor가 어색한 동작을 했을 때 신호
- 속도 preset 분포 → 0.5×가 많으면 시연 모드 사용자
- 플로킹 ON/OFF 비율 → 도구 6개 동시 시나리오가 흔한지

`AGENT_TOOL_UPDATE` dispatch 직후, `tool_use_end` 수신 직후가 자연스러운 후크 지점.

## §D-4. 체크리스트 (PR 머지 전)

- [ ] §A의 5개 모듈을 *수정 없이* 복사함 (cursor-store.ts 등)
- [ ] `mcp__<server>__*`이 `allowedTools`에 모두 포함됨
- [ ] `disallowedTools`에 `Bash`/`Read`/`Write` 등 SDK 기본 도구가 차단됨
- [ ] 모든 도구 핸들러는 ack-only (서버에서 reducer 안 함)
- [ ] `useAgent`가 `pendingTools` 추적 + `Promise.allSettled` 사용
- [ ] `tool_use_end`에서 `await executeTool` *없음* (fire-and-forget)
- [ ] `input_json_delta`를 accumulator로 합치지 *않음*
- [ ] reducer가 동시 dispatch 안전한 슬라이스 분리
- [ ] 모든 등록된 UI 요소가 `useEffect` cleanup에서 unregister됨
- [ ] 시스템 프롬프트에 ROLES 카탈로그 + 동시성 원칙이 명시됨
- [ ] 사용자 색 vs 에이전트 색이 분명히 구분됨
- [ ] `pointer-events: none`이 cursor overlay에 적용됨
- [ ] 점진적 도구가 있다면 시스템 프롬프트가 "한 번에 끝내지 마라"를 가르침
- [ ] dispatcher `finally` defensive cleanup 있음
- [ ] `result.is_error` 처리됨

## §D-5. 결정 로그 (왜 이렇게 만들었나)

| 결정 | 이유 |
|------|------|
| 외부 store (React 외부) | 60fps 트윈 × N개 커서를 React 렌더로 처리하면 끊긴다 |
| transform 직접 갱신 | setState 경유 시 fiber 스케줄링 비용 |
| 역할별 안정 ID | 같은 슬라이더에 두 번 가도 깜빡이지 않음 + 잔류 의미부여 |
| fire-and-forget | 동시성이 Shiva의 본질, 직렬화하면 매니저 메타포 죽음 |
| Promise.allSettled | 일부 도구 실패해도 나머지가 끝까지 진행 |
| input_json_delta 무시 | 병렬 도구일 때 race로 JSON 깨짐 |
| `Infinity` 속도 = 즉시 | 자동화 테스트가 같은 코드 경로로 실행 가능 |
| `pointer-events: none` | 커서는 *시각 표현*일 뿐, 입력은 사용자만 |
| `aria-live` 발화 | 시각 정보를 보조기술 사용자에게 동등 전달 |
| 사용자 색 vs 에이전트 스카이 | 같은 파랑 계열이지만 채도 차이로 구분 가능 |
| Fitts' Law duration | 거리 비례 자연스러움. 너무 짧으면 텔레포트, 너무 길면 답답 |
| sleep(150) 결정 시간 | "클릭 직전 망설임" 인간성 부여 + 사용자가 따라 보기 쉬움 |
| Bezier control + jitter | 직선은 부자연. 사람의 마우스는 *살짝 휘고 떤다*. |
| 점진적 슬라이더 (10단계) | 한 프레임 점프는 마법 같지만 *과정이 없어* 의심을 산다 |
| 점진적 scale 정제 (14회) | LLM이 한 번에 수렴 못 함 + 사람의 작업 방식 모방 |
| 서버 핸들러 ack-only | 진짜 동작은 DOM이 있는 브라우저에서만 가능 |
| state ref (live mirror) | useCallback deps 없이 stale closure 회피 |

---

# Part E — 부록

## §14. 파일 매핑 (이 레포 기준)

```
src/
  lib/
    cursor-store.ts          ← §2 외부 store + bezier tween + flocking
    ui-registry.ts           ← §4 DOMRect 등록
    sse-parser.ts            ← §8.4 클라 SSE
  hooks/
    useUserCursorTracking.ts ← §6.2 사용자 커서
    useAgent.ts              ← §7 fire-and-forget + state ref
  components/
    CursorOverlay.tsx        ← §6 DOM 렌더
    Sidebar.tsx              ← §4.2 등록 패턴 (SliderInput, ParcelChip, ZoneSelect)
    ConversationPanel.tsx    ← speed/flocking UI + 입력
    AppLayout.tsx            ← <CursorLayer /> 마운트
  agent/
    tool-executor.ts         ← §3, §5, §5b ROLES + operateUIElement +
                                progressiveSlider + 도구 17개 + 점진적 패턴
    system-prompt.ts         ← §9 태스크 매니저 프롬프트 (5.0.0-progressive)
    design-state-summary.ts  ← §9.1 자동 첨부 state
  app/
    api/agent/chat/route.ts  ← §8 Anthropic SDK + MCP 서버 + SSE
    globals.css              ← §10 디자인 토큰 + 커서 CSS
```

## §15. 이 레포의 ROLES (예시)

도메인이 *건축 일조사선*이라 다음과 같이 분류했다. 너의 도메인은 *다르게* 분류하라.

| 역할 | 라벨 | 색 | 담당 영역 | 도구 |
|------|-----|----|---------|------|
| `builder` | 도형 | `#E8784B` 오렌지 | 캔버스 도형 편집 | `draw_parcel` `move_vertex` `add_vertex_on_edge` `remove_vertex` `translate_parcel` `rotate_parcel` `duplicate_parcel` |
| (aux) | A1~A4 | `#7B6CD9` 보라 외 | 캔버스 꼭짓점 동시 (임시) | `scale_to_area` 내부 |
| `tunerFloor` | 층고 | `#7B6CD9` 보라 | 층고 슬라이더 | `set_floor_height` |
| `tunerMax` | 최대높이 | `#3FA88E` 청록 | 최대 높이 슬라이더 | `set_max_height` `set_floor_count` |
| `selectorZone` | 용도지역 | `#5B8DEF` 스카이 | 용도지역 select | `set_zone` |
| `picker` | 선택 | `#D9527B` 핑크 | 필지 칩/× 버튼 | `select_active_parcel` `delete_parcel` |
| `proposer` | 제안 | `#C7942A` 앰버 | 채팅 패널 ghost | `propose_alternatives` |

도메인 매핑 원칙: **"한 손이 동시에 다룰 만한 영역" 단위로 묶는다**. `tunerFloor`와 `tunerMax`는 둘 다 슬라이더지만 *다른 컨트롤*이므로 별도 cursor (병렬 호출 시 보라/청록 두 색).

## §16. 참조

- [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) — `query`, `createSdkMcpServer`, `tool`
- [Anthropic Tool Use 문서](https://docs.claude.com/en/docs/agents-and-tools/tool-use)
- [Fitts's Law](https://en.wikipedia.org/wiki/Fitts%27s_law) — 트윈 duration 산정
- [Boids — Craig Reynolds, 1986](https://www.red3d.com/cwr/boids/) — 플로킹 분리력
- [Cubic Bezier curve](https://en.wikipedia.org/wiki/B%C3%A9zier_curve#Cubic_B%C3%A9zier_curves) — 자연스러운 곡선 트윈
- 본 레포 `docs/PRD.md` — 도메인 컨텍스트 (이식 시 무관)
- 본 레포 `design-system.md` — 전체 디자인 토큰 명세

---

**문서 버전**: 2.0.0 — 포팅 가이드 재구성
**검증 기준**: prompt-version `5.0.0-progressive`, `@anthropic-ai/claude-agent-sdk ^0.2.121`, Next.js 16, React 19
**Last verified**: 본 레포 `src/`의 실제 코드와 1:1 일치
