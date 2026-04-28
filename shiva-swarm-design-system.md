# Shiva Multi-Cursor Swarm — Cover Hero 디자인 시스템

> **One sentence**: 메인 페이지 커버 히어로의 배경을 채우는, 사용자 마우스를 따라다니다 멈추면 카드형 통계 버블로 정착하는 5–8개 다색 커서 군집(swarm)의 표현·이동·버블·애니메이션 명세.

- **위치**: [index.html:410-428](index.html#L410-L428) (CSS), [index.html:1343-1346](index.html#L1343-L1346) (마크업), [index.html:2407-3080](index.html#L2407-L3080) (구현)
- **분리 문서**: 본 문서는 *현재 사이트의 커버 히어로* 한정. 더 넓은 *멀티 도구 호출 패턴* 자체의 포팅 가이드는 [shiva-multi-cursor.md](shiva-multi-cursor.md) 참조.
- **레퍼런스 커밋**: `49cc8a5 feat(home): replace cover hero with Shiva multi-cursor swarm` (#20)
- **랩 페이지**: [test-shiva-cursor.html](test-shiva-cursor.html) — 파라미터 튜닝용 standalone

---

## 0. 디자인 의도 (Why)

이 swarm은 *장식 모션*이 아니라 **AARO의 "여러 손이 동시에 다른 도구를 다룬다"는 매니페스토를 1초 안에 보여주는** 인터랙션이다. 사용자가 처음 보는 화면이고, 텍스트보다 먼저 인식되어야 한다.

핵심 메타포 3개:
1. **시바의 여러 손** — 단일 에이전트가 아니라 역할별 전담 손이 동시에 일한다. 다른 색·다른 라벨·다른 추격 패턴.
2. **포인터를 따라오는 무리** — 사용자가 마우스를 움직이면 *진짜로* 따라온다. UI 요소가 사용자에게 반응한다는 신호.
3. **멈추면 결과를 보여준다** — 가만히 있으면 각자 통계 카드를 펼친다. "에이전트들이 뭔가 결과를 들고 있다"는 시그널.

다음은 의도적으로 *피한* 것:
- 정해진 궤도(orbit)를 도는 입자 — "따라온다"는 느낌이 사라짐.
- 모든 커서가 같은 속도/같은 곡률로 추격 — 군집이 한 덩어리처럼 보여 "여러 명"이라는 메타포가 깨짐. → `pursueLag`, `lateralBias`, `eagerness`, `maxSpeed`, `connectorBias`를 커서마다 랜덤화.
- 멈출 때마다 N이 바뀌는 것 — 버블 레이아웃이 매번 흔들림. → 카운트 드리프트는 *추격 중에만* 동작.
- 히어로 타이틀 위로 버블이 덮이는 것 — 가독성 파괴. → `TITLE_RIGHT_EDGE` keep-out과 `userInSafeZone` 게이트.

---

## 1. 시스템 구성

### 1.1 DOM
```html
<div class="cover-graph" id="coverGraph">
  <canvas id="coverCanvas"></canvas>
</div>
```
- `position: absolute; inset: 0; z-index: 2; pointer-events: none;` — 커버 섹션을 가득 채우되 클릭은 통과.
- 캔버스 크기는 부모 `getBoundingClientRect`에서 받고, `devicePixelRatio` 보정 적용.

### 1.2 라이프사이클
- `IntersectionObserver`로 커버가 화면 밖이면 `requestAnimationFrame` 내부에서 `step/draw`를 건너뛴다 (RAF 자체는 계속 돌아 visibilitychange 비용을 피함).
- `prefers-reduced-motion: reduce` → 초기 카운트를 `COUNT_MIN(=5)`으로 강제, 이후 자동 카운트 드리프트는 그대로 동작 (속도 자체는 변하지 않음 — 필요 시 후속 작업).

### 1.3 단위·좌표계
- 모든 좌표는 캔버스 CSS px 기준. `dt`는 `Math.min(50, t - lastT)` 로 클램프해 탭 비활성에서 복귀할 때 점프 방지.
- 시간 기반 lerp는 60 fps 가정 (실프레임 보정은 미적용; UX 차이가 미미해 의도적으로 유지).

---

## 2. 역할 카탈로그 (ROLES)

각 역할은 **색·글리프·라벨·통계 3행**을 가지며, 커서 본체·라벨 pill·버블 헤더 원·연결선 색이 전부 동일한 `role.color`로 묶인다.

| Label        | Color     | Glyph | Stats (key → value)                                              |
|--------------|-----------|-------|------------------------------------------------------------------|
| Regulation   | `#7B6CD9` | `◇`   | FAR `2.10` ✓ / Height `48.0m` ✓ / Setbacks `OK` ✓                |
| Massing      | `#5B8DEF` | `◰`   | Iterations `12` / Score `0.82` / Daylight `Good`                 |
| Parking      | `#E8784B` | `P`   | Spaces `128` / Ratio `1 / 93 m²` / Access `OK`                   |
| Critic       | `#3FA88E` | `✱`   | Overshadowing `Low` / Wind `Acceptable` / Public Realm `Strong`  |
| Report       | `#D9527B` | `≡`   | Pages `42` / Diagrams `18` / Status `Draft`                      |
| Context      | `#C7942A` | `◐`   | Views `Good` / Noise `Low` / Access `Strong`                     |

`stats[i].ok === true` 인 행은 우측에 색상 체크(`✓`)를 추가한다 (현재 Regulation 3행만 해당 — "준수" 메타포).

**카운트 vs 역할 수**: 역할은 6개, 활성 swarm 크기는 5–8. 역할 중복은 허용된다. 새 커서를 spawn할 때는 `pickFreshRole()`로 *지금 가장 적게 등장한 역할*을 고른다 → 6개 역할 중 무엇이 항상 1개 이상은 유지되도록.

**확장 시 주의**: 색은 `role.color`로 인라인 사용되므로 디자인 토큰화 없이 직접 변경. 글리프는 IBM Plex Mono로 그려지고 단일 문자 가정 (멀티-codepoint 이모지 금지 — 폰트 fallback이 깨짐).

---

## 3. 표현 (Visual Representation)

### 3.1 커서 본체 — Path2D 화살표
```js
ARROW_PATH = new Path2D('M 0 0 L 0 18 L 5.2 14 L 8.6 21.8 L 11.4 20.6 L 8 13 L 14.4 13 Z');
```
- macOS 시스템 화살표를 단순화한 14×22 폴리곤. 원점이 화살표 *팁*(0,0)에 위치.
- Fill: `role.color`, Stroke: `rgba(255,255,255,0.85)` 1.2px (어두운 배경에서도 윤곽이 끊기지 않게).
- 회전 기준점은 팁이므로 `ctx.translate(c.x, c.y); ctx.rotate(c.rot);` 후 `fill(ARROW_PATH)`.

### 3.2 드롭 섀도우 — World-space
회전과 *독립적*. 화살표가 어느 방향을 향하든 그림자는 항상 우측 하단 (1.2, 1.6) 으로 떨어진다.
```js
ctx.translate(c.x + 1.2, c.y + 1.6);
ctx.rotate(c.rot);
ctx.fillStyle = 'rgba(0,0,0,0.20)';
ctx.fill(ARROW_PATH);
```
*만약* 그림자도 회전과 함께 돌면 화살표가 좌향일 때 그림자가 "반대편"으로 가는 부자연스러움이 생긴다. 광원은 좌상단 고정.

### 3.3 라벨 Pill
화살표 우측에 `c.x + 16, c.y + 2` 좌표로 **role 색 배경 + 흰 글자** 둥근 pill (`r=9`, h=18). 폰트: `600 11px 'DM Sans'`.

**속도 페이드** — 빠르게 추격 중일 때 pill이 어지러우므로:
```js
const sp = Math.hypot(c.vx, c.vy);
const speedFade = sp > 1.6 ? Math.max(0, 1 - (sp - 1.6) / 2.5) : 1;
const labelOp = (1 - c.bubbleOp) * speedFade;
```
- `sp ≤ 1.6` → 100% 보임.
- `sp ≥ 4.1` → 완전히 숨김.
- 또한 `bubbleOp`가 올라가면(쉬는 중) pill을 점진적으로 죽임 → 버블이 라벨 정보를 "확장"한 셈.

### 3.4 트레일 (Dashed Trail)
각 커서가 자기 위치를 `(x, y, t)` 로 push, 1300 ms TTL로 트림.
```js
ctx.setLineDash([2, 3.5]);
ctx.lineCap = 'round';
ctx.lineWidth = 1.3;
```
- alpha: `(isDark() ? 0.74 : 0.62) × (1 - bubbleOp) × lifeOp × (1 - age)²`
- 다크 모드 베이스가 더 강한 이유: 어두운 배경이 낮은 alpha 점선을 흡수해 거의 보이지 않기 때문.
- `(1 - age)²` (quadratic falloff): 최근 점은 또렷, 오래된 점은 빠르게 ghost 처리 → "잔상 길이"가 짧아 보이지만 풍성한 느낌.
- 짧은 점-짧은 갭 (2 / 3.5) 이 길이 곡선 위에서 부드러운 dotted line으로 읽히게 하는 핵심 — 더 길어지면(예: 6/8) 모스부호처럼 보인다.

### 3.5 사용자→커서 부드러운 연결선 (Pursuit Connector)
추격 중에만, 사용자 포인터 ↔ 각 커서를 *얇고 흐릿한 직선*으로 잇는다.
```js
const swarmLineOp = 1 - max(c.bubbleOp);            // 누구라도 버블을 펼치면 전체 페이드
if (user.active && swarmLineOp > 0.05) { ... }
const op = clamp(1 - d/240, 0.04, 0.18) × 0.55 × swarmLineOp × c.lifeOp;
```
- 거리 240px 초과 커서는 그리지 않음 — "지근거리 협력 중"인 인상만.
- 폭 0.6, 단일 직선, 점선 아님 — 트레일(점선)과 명확히 구분.

---

## 4. 이동 모델 (Movement)

추격(pursuit) 모드와 휴식(rest) 모드 두 가지가 있고, **사용자 마지막 입력으로부터 700 ms** 경과를 기준으로 토글된다.

### 4.1 사용자 포인터 트랙 (userTrail)
- `mousemove` / `touchmove` 시 `(x, y, performance.now())` push.
- 1500 ms TTL로 트림.
- 추격 타깃은 *현재* 포인터 위치가 아니라 **`pursueLag` 만큼 과거의 포인터 위치** (`trailPointAt(now, lagMs)`).
- 이게 "여러 손이 *지연 분산되어* 따라온다"는 비주얼의 핵심. 모두 같은 점을 추격하면 한 덩어리로 뭉친다.

### 4.2 추격 타깃 산식
사용자 속도 `(vx, vy)` 단위벡터 `(ndx, ndy)`, perpendicular `(perpX, perpY) = (-ndy, ndx)`:
```js
const lag = trailPointAt(now, c.pursueLag);                     // 60–280 ms 과거의 포인터
tx = lag.x + perpX * c.lateralBias * 75 - ndx * 35;             // 측면 편향 + 전방 오프셋
ty = lag.y + perpY * c.lateralBias * 75 - ndy * 35;
```
- **lateralBias** ∈ `[-0.95, +0.95]` — 사용자 진행방향의 좌/우 어느 쪽으로 75px 치우쳐 따라오는지. 커서별 고정.
- **전방 오프셋 -35**: 사용자 진행방향의 *반대*로 35px 뒤쪽 — "뒤따라오는" 느낌.
- 결과: 사용자가 우측으로 움직이면 커서들은 진행방향을 기준으로 좌·우로 부채꼴 펼친 채 *살짝 뒤*에서 따라온다.

### 4.3 Boids — 분리 / 정렬
거리 기반 두 힘:
```js
SEP_RADIUS: 78,   SEP_FORCE: 1.8,   // (실제 적용 시 ×4 가중)
ALI_RADIUS: 100,  ALI_FORCE: 0.05,
```
- **Separation**: 78px 안에 들어온 다른 커서로부터 밀어냄. (`SEP_RADIUS - d) / SEP_RADIUS`로 가까울수록 강함.
  - 78이라는 값은 *라벨 pill 폭 + 화살표 본체* 가 겹치지 않는 최소 안전거리에서 결정.
- **Alignment**: 100px 이웃의 평균 속도로 자기 속도를 0.05 비율로 끌어옴 — *같이* 흐르는 약한 응집.
- **Cohesion(중심 인력)은 사용하지 않는다** — 사용자 포인터 추격이 cohesion 역할을 대신한다.

### 4.4 사용자와의 거리 제약 (Leash + Personal Space)
```js
LEASH_R: 320,      LEASH_FORCE: 0.06,
PERSONAL_SPACE: 50,
```
- **Leash**: 사용자에서 320px 초과로 멀어지면 그 *초과분*에 비례해 사용자 쪽으로 끌려옴. 무리가 풍선처럼 사용자를 둘러쌈.
- **Personal Space**: 50px 안으로 들어오면 사용자 *반대 방향*으로 1.4 가중치로 밀려남. 화살표가 사용자 포인터를 가리는 사고를 방지.

### 4.5 캔버스 경계 반발
`m=24`px 안쪽에서 부드러운 스프링(`×0.05`)으로 안쪽으로 되돌림. 하드 클램프가 아니라 *밀어내기*라 모서리에서 머무는 일이 없다.

### 4.6 휴식 모드 — 슬롯 배치 (`assignRestPositions`)
사용자가 700ms 동안 멈추면 한 번 호출되고, 다시 움직이기 전까지 슬롯은 고정된다.

```
slotSize = 2π / N
phase    = (타이틀 좌측 있음) -π/3 + ±slotSize·0.15 (랜덤)
           (그 외)             랜덤 [0, slotSize)
ringR    = stagger && i 홀수 ? baseR × 0.74 : baseR
baseR    = clamp(safeR, 80, 240)
safeR    = min( safeLeft,
                W - user.x - sideMargin,
                user.y - topMargin,
                H - user.y - bottomMargin )
sideMargin   = 60 + bubbleReach(110)
topMargin    = 70 + bubbleReach(110)
bottomMargin = 90 + bubbleReach(110)
safeLeft     = user.x - max(TITLE_RIGHT_EDGE + 80, 80) - bubbleReach
```

핵심 결정:
- **등각 링** (모두 같은 반경) — 인접 슬롯이 다른 링에 있으면 버블 모서리가 겹치는 경우가 많아 단일 링이 기본.
- **N ≥ 8 일 때만 staggered ring** — 슬롯 피치가 좁아져 실제로 충돌하는 시점에서만 안쪽 반경 0.74×로 짝수/홀수 분리.
- **타이틀 keep-out**: 데스크탑(≥1024px)에서 `TITLE_RIGHT_EDGE = W × 0.50`. `safeLeft`가 이 경계를 넘지 못하도록 baseR 후보값에 포함.
- **타이틀이 있을 때 phase = -π/3**: 첫 슬롯이 우상향으로 시작 → 좌측 타이틀 영역에서 멀어진 곳부터 채움.
- **chrome 마진**: 상단 nav, 하단 chat FAB, 좌우 페이지 마진 모두 `bubbleReach(110)`을 더해 *버블 외곽선* 까지 안전.
- **순서 셔플**: `cursors.slice().sort(() => Math.random() - 0.5)` — 같은 역할이 항상 같은 슬롯에 가지 않도록.

각 커서는 자기 슬롯으로 `REST_FORCE × eagerness` 의 인력으로 끌리고, 타깃과 50px 이내일 때 damping이 `DAMPING(0.90)` → `REST_DAMPING(0.82)`로 강해져 부드럽게 *정착*한다.

### 4.7 회전 (Rotation)
`MOVE_THRESH = 0.55` 보다 빠르면 **속도 벡터에 정렬**, 휴식 + `REST_LOCK_DIST(=22)` 이내면 **0(rad)으로 천천히 복귀**.
```js
targetRot = atan2(vy, vx) + π - 1.13;   // 화살표 팁 기준점 보정 오프셋
a.rot += dRot * ROT_LERP(0.18);          // shortest-arc lerp
```
- `+π - 1.13` 은 ARROW_PATH의 팁이 +Y(아래)를 향하도록 그려져 있어 좌→우 진행을 0 rad에 매핑하기 위한 보정. 변경 시 화살표 path도 함께 봐야 함.
- `ROT_LERP = 0.18` — 1프레임당 18%만 따라가므로 회전이 *부드럽게 따라잡는* 모습. 더 높이면 칼 같은 회전, 낮추면 늘어진다.
- 휴식 시 0으로 복귀(`× 0.06`) → 모든 화살표가 똑바로 위를 향한 채 정착 (질서감).

---

## 5. 메인(사용자) 커서와의 관계

| 측면              | 메커니즘                                                                                           |
|-------------------|--------------------------------------------------------------------------------------------------|
| **추격 표적**      | `userTrail`의 `pursueLag(60–280ms)` 과거 위치 — 커서마다 다름                                       |
| **편대(formation)** | 사용자 진행방향에 직교한 ±75px (`lateralBias`)로 부채꼴, 진행방향 -35px 뒤로                        |
| **거리 상한**      | `LEASH_R = 320` — 무리가 화면 끝으로 흩어지지 않게 사용자를 풍선처럼 따라옴                         |
| **거리 하한**      | `PERSONAL_SPACE = 50` — 화살표가 사용자 마우스 팁을 가리지 않도록 밀어냄                           |
| **연결선**        | 추격 중, 240px 이내, alpha 0.04–0.18, 폭 0.6 — "연동 중"의 약한 시각적 끈                          |
| **휴식 트리거**    | `IDLE_MS = 700` 동안 마우스 미동 → 슬롯 배치 1회 + 점진적 정착                                       |
| **타이틀 보호**    | `userInSafeZone = user.x > TITLE_RIGHT_EDGE + 80` 인 경우에만 버블 reveal — 타이틀 위로 카드 안 뜸 |
| **자동 데모**      | 사용자 미인터랙션 상태에서 9000ms 사이클(이동 55% / 휴식 45%)로 사용자 포인터를 *위조* 이동시킴      |

**자동 데모 (Auto-demo)** — 첫 방문자가 마우스를 안 움직여도 "추격→휴식→버블 reveal" 한 사이클을 보고 가야 한다는 결정. 가짜 포인터는 화면의 안전 영역 안(`TITLE_RIGHT_EDGE + 300 ≤ x ≤ W × 0.85`)에서만 움직여 데스크탑 타이틀과 충돌하지 않는다. 사용자가 한 번이라도 움직이면 (`userHasInteracted = true`) 자동 데모는 영구히 꺼진다.

---

## 6. 이동 속도 (Speed)

| 요소               | 값                                  | 의미                                                                 |
|--------------------|-------------------------------------|----------------------------------------------------------------------|
| `maxSpeed`         | `4.6 + random × 2.4` → [4.6, 7.0]   | 커서별 최대 속도 캡 — 일부는 항상 늦고 일부는 항상 빠르다             |
| `eagerness`        | `0.7 + random × 0.7` → [0.7, 1.4]   | 추격/휴식 가속도 곱 — "얼마나 의욕적으로" 타깃을 따라가는지            |
| `pursueLag`        | `60 + random × 220` → [60, 280] ms  | 사용자 *과거* 위치를 추격할 지연시간                                   |
| `lateralBias`      | `[-0.95, +0.95]`                    | 진행방향 측면 편향                                                    |
| `connectorBias`    | `[-0.9, +0.9]`                      | 버블 연결곡선의 굽힘 방향 (좌/우)                                     |
| `DAMPING`          | `0.90`                              | 매 프레임 속도 감쇠                                                   |
| `REST_DAMPING`     | `0.82`                              | 휴식 슬롯에 50px 이내일 때 강한 감쇠 → 정착                          |
| `MOVE_THRESH`      | `0.55`                              | 회전 정렬을 시작할 최소 속도                                           |
| `REST_LOCK_DIST`   | `22`                                | 슬롯에 22px 이내면 회전을 0으로 복귀, 노이즈 제거                      |
| `PURSUE_FORCE`     | `0.038`                             | 추격 인력 계수 (× eagerness)                                          |
| `REST_FORCE`       | `0.045`                             | 휴식 인력 계수 (× eagerness)                                          |
| `IDLE_MS`          | `700`                               | 사용자 입력 미발생 임계 — 추격 ↔ 휴식 토글                             |
| `dt` 클램프        | `Math.min(50, t - lastT)`           | 탭 비활성 후 복귀 시 점프 방지                                         |
| 노이즈 jitter      | `±0.05`                             | 휴식 락 영역 *밖*에서만 미세 떨림 (정착 후엔 끔)                       |

**프로파일별 속도 캐릭터** (랜덤 시드별로 다음 패턴 중 하나가 됨):
- 빠르고 의욕적: `maxSpeed≈7, eagerness≈1.4, pursueLag≈80ms` — 거의 사용자에 붙어 다님.
- 느리고 게으른: `maxSpeed≈4.6, eagerness≈0.7, pursueLag≈260ms` — 한 박자 늦게, 멀리서 끌려옴.
- 중간 + 강한 측면: `lateralBias=±0.9` — 사용자 옆구리에서 지속적으로 평행 이동.

이 분포가 매번 새로 spawn될 때마다 새로 뽑히므로, 카운트 드리프트로 들어온 새 커서가 기존 분포에 자연스러운 변주를 더한다.

---

## 7. 버블 (Role Stat Bubbles)

### 7.1 사이즈·구조
```js
BUB = { w: 174, headerH: 30, rowH: 18, padX: 14, padY: 12, radius: 12 }
height = headerH + stats.length × rowH + padY  // 3행 기준 30 + 54 + 12 = 96
```
- 폭 174px 고정 — 가장 긴 stat 값(`Acceptable`, `1 / 93 m²`)을 padding 포함 안전하게 담음.
- 모서리 12px 라운드.
- **테마 인식 배경**: 다크 `rgba(28,28,26,0.95)` / 라이트 `rgba(255,255,255,0.97)`. 그림자 `rgba(0,0,0,0.12) blur 14, offsetY 4`.
- **테마 인식 테두리**: 다크 `rgba(237,232,224,0.18)` / 라이트 `rgba(26,26,24,0.10)` 0.8px — 다크 배경이 낮은 alpha를 흡수하므로 다크에서 더 강하게.

### 7.2 헤더 (30px)
- 좌측 8px 원, role 색, 흰색 글리프 (IBM Plex Mono 600 11px) — 글리프는 **단일 codepoint**.
- 라벨: `DM Sans 600 13px`, 다크 `#EDE8E0` / 라이트 `#1A1A18`.
- 우측 끝 3.5px dot, role 색 — 미니멀한 "active" 인디케이터.
- 헤더 하단 1px 디바이더, 테마 alpha 보정.

### 7.3 통계 행 (rowH = 18)
```
key (DM Sans 500 11px, ink-55%)        value (Plex Mono 500 11px, ink) [✓ if ok]
```
- 좌측 정렬 key, 우측 정렬 value, 그리고 `stat.ok === true` 인 행만 우측 끝 ✓ (role 색).
- 모노 폰트로 value를 그리는 이유: 숫자/단위가 시각적으로 *데이터처럼* 읽히게.

### 7.4 위치 — 커서 옆 *바깥쪽*
```js
const dirX = c.x - user.x, dirY = c.y - user.y;     // 사용자에서 커서로 향하는 방향
const ax = c.x + ndx × 26;                          // 커서에서 더 바깥으로 26px
const ay = c.y + ndy × 26;
bx = ax + (ndx ≥ 0 ? 0 : -w);                       // 커서가 사용자 우측이면 버블도 우측
by = ay + (ndy ≥ 0 ? 0 : -h);
clamp to [8, W-w-8] × [8, H-h-8];
```
- 항상 사용자에서 *멀어지는* 쪽으로 버블이 펼쳐진다 → 사용자 시야의 중심(타이틀)을 가리지 않음.
- 커서가 사용자 좌상단에 있으면 버블도 좌상단으로 펼침 등 4사분면 자연 매핑.
- 8px 마진 클램프로 화면 밖으로 안 나감.

### 7.5 연결 곡선 (Connector)
커서 → 버블 헤더 한쪽 모서리(좌측 또는 우측 8px 안쪽, 헤더 중앙 14px)로 **점선 quadratic curve**.
```js
ctx.setLineDash([3, 5]);
ctx.lineWidth = 1;
ctx.strokeStyle = role.color;     // alpha = bubbleOp × lifeOp × 0.55

// 곡선의 굽힘 방향은 커서별 connectorBias로 좌/우 결정
perp = (-segDy/segLen, segDx/segLen);
bend = min(28, segLen × 0.22);
cp   = midpoint + perp × bend × c.connectorBias;    // ∈ [-0.9, +0.9]
```
- 커서마다 곡선이 *다른 쪽으로* 휘어지고, 곡률도 달라 — 컨셉 이미지의 "흩날리는 호"를 재현.
- 점선 스펙(3 / 5)은 트레일(2 / 3.5)보다 약간 더 길어 *서로 다른 종류의 선*임을 구분.

### 7.6 버블 reveal 게이트 (`atRest`)
```js
const userInSafeZone = user.x > TITLE_RIGHT_EDGE + 80;
const atRest = isIdle && distToTarget < REST_LOCK_DIST && userInSafeZone;
```
세 조건 모두 만족 시에만 `bubbleOp → 1` 로 lerp.
- **`isIdle`** — 700ms 미동.
- **`distToTarget < 22`** — 슬롯에 정확히 정착했을 때만. 도중에 폭발적으로 펼쳐지지 않음.
- **`userInSafeZone`** — 사용자가 타이틀 위에서 마우스를 멈추면 버블이 안 뜸. *읽기 우선*.

### 7.7 fade-in vs fade-out
```js
const lerp = targetOp > a.bubbleOp ? 0.045 : 0.14;
```
- 들어올 때 0.045 (slow, ~수백ms) — 정보가 천천히 쌓이는 느낌.
- 나갈 때 0.14 (~3× 빠름) — 사용자가 다시 움직이면 즉시 사라져 시야 클리어.

---

## 8. 라이프사이클 & 카운트 드리프트

### 8.1 동적 카운트 [5, 8]
- 추격 모드에서만 동작 (`maybeChangeCount(dt, isIdle)` — `isIdle` 시 즉시 return).
- 휴식 중엔 잠금 → 슬롯 배치가 흔들리지 않음.

```js
COUNT_CHANGE_INTERVAL_MS = 5500
다음 변화까지: countChangeTimer ≥ 5500 도달 후 -random×2500 으로 리셋 (≈ 5.5–8s 사이클)

이벤트 분포:
  r < 0.4 && N < 8  → 추가 (사용자 포인터 위치에서 fade-in)
  0.4 ≤ r < 0.8 && N > 5 → 임의 1개 dying = true (fade-out)
  else → 변화 없음
```
- 추가 시 역할은 `pickFreshRole()` — 현재 가장 적은 역할을 채움.
- 추가 위치는 *사용자 포인터*: "방금 합류했다"는 메타포. 초기 spawn은 `(W×0.6, H×0.5)` 주변에 흩뿌림.

### 8.2 lifeOp (lifecycle fade)
```js
lifeTarget = a.dying ? 0 : 1;
lifeLerp   = lifeTarget > a.lifeOp ? 0.04 : 0.10;     // in ~600ms / out ~250ms
if (a.dying && a.lifeOp < 0.03) cursors.splice(i, 1);  // reap
```
- 페이드 인이 페이드 아웃보다 ~2.5× 느림 — *합류*는 천천히 인지, *퇴장*은 빠르게.
- **lifeOp는 그리는 모든 요소의 globalAlpha 곱셈자**: 화살표, 그림자, 라벨 pill, 트레일, 연결선, 버블. 어떤 부분만 먼저 사라지는 일이 없도록 `drawCursor`/`drawTrail`/`drawBubble` 모두 `lifeOp` 곱.

### 8.3 bubbleOp
- 0 → 1 lerp 0.045 (느림)
- 1 → 0 lerp 0.14 (빠름)
- 트레일 alpha와 라벨 pill alpha 모두 `(1 - bubbleOp)`로 곱해져, 버블이 펼쳐질 때 자연스럽게 *그 외 요소가 정리*된다.

### 8.4 회전 lerp
- `ROT_LERP = 0.18` (이동 시), `0.06` (휴식 시 0으로 복귀).
- shortest-arc 보정 (`while dRot > π → -2π` 등)으로 ±π 경계에서 빠른 회전이 안 일어남.

### 8.5 트레일 lifecycle
- 매 step에서 `sp > 0.4` 일 때만 push → 정지한 커서는 트레일이 안 쌓임.
- `now - p.t > 1300` 시 shift.
- 그리기 alpha: `base × (1 - age)²` — 끝부분이 quadratic으로 흐려짐.

### 8.6 자동 데모 (사용자 인터랙션 전)
```
CYCLE_MS  = 9000   // 9초 사이클
MOVE_FRAC = 0.55   // 그 중 첫 5초가 가짜 이동, 나머지 4초는 멈춤(→ 휴식 → reveal)
가짜 포인터: (cx, cy) = ( safe X 영역 코사인, H×0.5 + sin × H×0.16 )
```
- 사용자가 한 번이라도 마우스를 움직이면 영구 비활성.
- `safeMinX = TITLE_RIGHT_EDGE + 300, safeMaxX = W × 0.85` — 데스크탑 타이틀과 우측 마진 충돌 방지.

### 8.7 prefers-reduced-motion
- 초기 카운트 = `COUNT_MIN(=5)`.
- 그 외 모든 모션 파라미터는 *유지*되어 있음 — 완전한 정적 모드는 미구현. 후속 개선 여지: 카운트 드리프트 끄기, 자동 데모 끄기, 트레일 제거.

---

## 9. 테마 (다크/라이트)

| 요소               | 라이트                                | 다크                                       | 비고                                        |
|--------------------|---------------------------------------|--------------------------------------------|---------------------------------------------|
| 트레일 base alpha   | `0.62`                                | `0.74`                                      | 다크 배경이 낮은 alpha를 흡수해 강화         |
| 버블 배경          | `rgba(255,255,255,0.97)`              | `rgba(28,28,26,0.95)`                       |                                             |
| 버블 테두리        | `rgba(26,26,24,0.10)` 0.8px            | `rgba(237,232,224,0.18)` 0.8px              |                                             |
| 버블 헤더 글자색   | `#1A1A18`                             | `#EDE8E0`                                  |                                             |
| stat key           | `rgba(26,26,24,0.55)`                 | `rgba(237,232,224,0.55)`                    |                                             |
| stat value         | `#1A1A18`                             | `#EDE8E0`                                  |                                             |
| 헤더 디바이더      | `rgba(26,26,24,0.08)` 0.6px           | `rgba(237,232,224,0.16)` 0.6px              |                                             |
| 그림자             | 동일 `rgba(0,0,0,0.12) blur 14`        | 동일                                        | 다크에서도 카드를 띄우는 데 충분            |
| Role colors        | 동일                                  | 동일                                        | 두 테마에서 모두 충분한 대비 — 변경 시 검증 |

테마 detection: `document.documentElement.dataset.theme === 'dark'` (`isDark()` 헬퍼). 매 프레임 호출되지만 평가가 가벼워 캐싱 안 함.

---

## 10. 반응형

| 뷰포트        | 변화                                                                                                  |
|---------------|------------------------------------------------------------------------------------------------------|
| ≥ 1024px      | `TITLE_RIGHT_EDGE = W × 0.50` (좌측 절반에 타이틀 keep-out), 초기 카운트 6                              |
| < 1024px      | 타이틀이 중앙 정렬되므로 keep-out 없음, swarm은 더 자유롭게 배치                                        |
| < 720px       | 초기 카운트 = `COUNT_MIN(5)`                                                                           |
| < 760px(CSS)  | `cover-graph`가 하단 50%만 차지 (`top:auto; bottom:0; height:50%; opacity:0.5`) — 모바일 타이틀 보호    |

`window.resize` → `resize()` 재계산. 카운트 드리프트 타이머나 슬롯 배치는 다음 idle 진입 시 자연스럽게 새 사이즈에 맞게 재배치.

---

## 11. 파라미터 빠른 참조

```js
// 시각
ARROW_PATH    = Path2D('M 0 0 L 0 18 L 5.2 14 L 8.6 21.8 L 11.4 20.6 L 8 13 L 14.4 13 Z')
SHADOW_OFFSET = (1.2, 1.6)
LABEL_OFFSET  = (16, 2)   // pill 좌상단 from cursor
LABEL_FONT    = "600 11px 'DM Sans'"
TRAIL_DASH    = [2, 3.5]    TRAIL_W = 1.3    TRAIL_TTL = 1300ms
USER_TRAIL_TTL = 1500ms

// boids / pursuit
SEP_RADIUS=78  SEP_FORCE=1.8
ALI_RADIUS=100 ALI_FORCE=0.05
PURSUE_FORCE=0.038  REST_FORCE=0.045
DAMPING=0.90        REST_DAMPING=0.82
LEASH_R=320         LEASH_FORCE=0.06
PERSONAL_SPACE=50
IDLE_MS=700         REST_LOCK_DIST=22
ROT_LERP=0.18       MOVE_THRESH=0.55

// 카운트
COUNT_MIN=5  COUNT_MAX=8
COUNT_CHANGE_INTERVAL_MS=5500   // 다음 변화까지 ≈ 5.5–8s
add 확률 0.4  remove 확률 0.4   no-op 0.2

// 커서별 랜덤
maxSpeed     ∈ [4.6, 7.0]
eagerness    ∈ [0.7, 1.4]
pursueLag    ∈ [60, 280] ms
lateralBias  ∈ [-0.95, +0.95]
connectorBias∈ [-0.9, +0.9]

// 버블
BUB.w=174  headerH=30  rowH=18  padX=14  padY=12  radius=12
bubbleReach = 110            // 슬롯 안전 마진에 추가
sideMargin=170 topMargin=180 bottomMargin=200    // = chrome + bubbleReach
baseR ∈ [80, 240]
stagger ring at N≥8 (innerR = baseR×0.74)

// 자동 데모
CYCLE_MS=9000  MOVE_FRAC=0.55

// 페이드
bubbleOp lerp:  in 0.045 / out 0.14
lifeOp   lerp:  in 0.04  / out 0.10
rest rotation:  lerp 0.06 toward 0
```

---

## 12. 확장·튜닝 가이드

**역할(role)을 추가/변경할 때**
- 색은 라이트·다크 양쪽에서 흰 글자(라벨 pill, 글리프)와 본체 stroke `rgba(255,255,255,0.85)`이 모두 읽혀야 함. WCAG AA 권장.
- 글리프는 `IBM Plex Mono` 단일 codepoint. 이모지 사용 시 라벨 pill 배경과의 대비가 깨지므로 비권장.
- stats는 항상 3행 가정 (`bubbleHeight = headerH + stats.length × rowH + padY`로 동적이긴 하나, 슬롯 마진이 3행 기준으로 튜닝됨 — 4행 이상은 `bubbleReach`도 같이 올려야 함).

**카운트 윈도우 [5, 8] 변경**
- 슬롯 stagger는 `N ≥ 8` 기준으로 `baseR × 0.74` 처리. 9 이상으로 올리면 stagger 비율과 슬롯 피치 모두 재튜닝 필요.
- 5 미만은 무리감(swarm)이 약해져 메타포가 깨짐 (단일 에이전트와 구분이 모호).

**속도 캐릭터를 바꿀 때**
- `maxSpeed × eagerness × PURSUE_FORCE` 가 *추격 가속의 상한* 이므로 함께 조정.
- 너무 빠르면 사용자 마우스를 *추월*하는 사고 (`pursueLag` 의도가 무력화) — `LEASH_R`로 막아두긴 했지만 실효 한계.

**테마 추가 시**
- `isDark()`가 boolean이라 추가 테마는 별도 헬퍼와 분기 필요.

**랩 페이지에서 튜닝**
- [test-shiva-cursor.html](test-shiva-cursor.html)에 모든 파라미터가 슬라이더로 노출 — 시각적으로 잡고 본 파일에 동기화.

---

## 13. 알려진 한계

- **`prefers-reduced-motion` 부분 대응**: 카운트만 줄이고 모션은 그대로. 트레일/회전/swarm 추격까지 끄는 옵션은 미구현.
- **dt 보정 없음**: 60 fps 기준 lerp. 30 fps 디바이스에서 정착이 약 2× 느림 (UX 차이가 작아 의도적으로 유지).
- **모바일 터치 추격은 첫 터치 시점부터**: 터치 종료 후 `user.lastMove`가 갱신 안 되므로 즉시 휴식 모드로 진입 (의도된 동작).
- **N=1 초기 spawn은 발생하지 않음** (`COUNT_MIN=5`): 단일 커서 모드는 별도 컴포넌트가 필요하면 구현해야 함.
- **iframe 안에서는 정상 작동하지만 부모 페이지의 마우스 이벤트는 받지 않음**: 커버를 임베드할 때 자동 데모만 동작.

---

## 14. 변경 이력

| Date       | 변경                                              | Commit    |
|------------|---------------------------------------------------|-----------|
| 2026-04-29 | 초기 swarm 구현, 커버 히어로 교체, 본 디자인 시스템 문서 분리 | `49cc8a5` |
