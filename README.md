# aaro

**Architectural Algorithm Research Office** — Design Lab & Academy

AARO는 AI를 자동화 도구가 아닌, 설계 판단을 확장하는 파트너로 사용하는 건축 알고리즘 연구소입니다. 자연어와 공간 규칙을 연결해 설계 의도를 구조화하고 즉시 검증 가능한 결과로 바꿉니다.

## Overview

Single-page interactive brand website built with vanilla HTML, CSS, and JavaScript. Deployed on Vercel.

### Sections

| # | Section | Description |
|---|---------|-------------|
| S0 | Cover | Animated title with World Agent node graph |
| S1 | Manifesto | Mission statement with live counter stats |
| S3 | Micro Apps | Marquee showcase of AARO algorithm applications |
| S4 | Agent Architecture | Interactive canvas — draggable node graph of World Agent + Micro Apps |
| S4b | Playground | Inline interactive demos: Ground Level, Brick Wall, Parking Layout |
| S5 | About / Capabilities | Domain status table (Production / Beta / Alpha) |
| S6 | Footer | Contact, address, social links |

### Micro Apps (24+)

AARO의 알고리즘 마이크로 앱 포트폴리오:

| App | Category | Description |
|-----|----------|-------------|
| Circle Packing | Generation | 원형 배치 최적화, 지오메트리 실험 |
| Plant Algorithm | Generation | 식재 배치, 조경 자동화 |
| Bubble Diagram | Planning | 공간 관계 다이어그램, 다양한 유형의 배치 계산 |
| Building Layout | Evaluation | 건물 배치 분석 |
| Advanced Offset | Generation | 옵셋 기반 형태 생성 |
| Furnishing | Optimization | 가구 배치 최적화 |
| WFC Pavilion | Generation | Wave Function Collapse 패턴 생성 |
| Ground Level | Simulation | 가중평균 지표면 산정 (건축법 시행령) |
| Archboard | Dashboard | 건축 대시보드 |
| Land Splitter | Generation | 토지/필지 분할 자동화 |
| Layout Optimizer | Optimization | 모듈러 레이아웃 최적화 |
| Monitoring | Dashboard | Vercel 배포 모니터링 |
| Design Scope | Evaluation | 설계 범위 분석 |
| Unit Splitter | Generation | 세대 분할, 유닛 배분 자동화 |
| Gongsi | Evaluation | 공시지가 분석 |
| AI Legal | Evaluation | 건축법규 AI 검토 |
| Raster to Vector | Generation | 래스터→벡터 변환 |
| Design Planning | Planning | 설계 기획 알고리즘 |
| GH Canvas | Evaluation | Grasshopper 캔버스 해석 |
| Urban Timemap | Evaluation | 도시 시간 변화 시각화 |
| Parking | Optimization | 주차 배치 최적화 (지상/지하) |
| Topography | Simulation | 지형 분석, 등고선 |
| AARO World | Dashboard | 3D 도시 환경 시뮬레이션 |
| Brick | Generation | 벽돌 패턴 디자인, 이미지 기반 패턴 생성 |

### Playground

메인 페이지에 인라인으로 삽입된 인터랙티브 알고리즘 데모:

| Demo | Features |
|------|----------|
| Weighted Ground Level | 꼭지점 드래그, 높이(FH) 조정, 단면도 연동 |
| Brick Generation | 이미지→벽돌 회전 패턴, 3D 궤도 회전, W/H 슬라이더 |
| Parking Layout | 경계 편집, Edge/Inner 주차 배치, Access Lane 시각화, Circulation 동선 |

### World Agent

모든 마이크로 앱을 연결하는 에이전트 아키텍처. 개별 앱을 조합하여 복잡한 설계 문제를 해결.

- SLOW 프레임워크: Systems(통합), Logic(추론), Optimization(탐색), Workflows(배포)
- 자연어 입력 → 알고리즘 조합 → 설계 결과 생성

### Capabilities

| Domain | Status |
|--------|--------|
| Massing & Volume | Production |
| Regulation Compliance | Production |
| Urban Analytics | Production |
| Floor Plan Generation | Beta |
| Parking & Circulation | Beta |
| Energy Simulation | Alpha |
| Structural Analysis | Alpha |

## Tech Stack

- **HTML/CSS/JS** — No build step, single `index.html` + `playground/`
- **Fonts** — DM Sans, IBM Plex Mono, Noto Sans KR (Google Fonts)
- **API** — Vercel Serverless Functions (`api/chat.js`, `api/contact.js`)
- **Hosting** — Vercel (`vercel.json` for clean URLs)

### Design Tokens

```css
--ink:     #0D0D0C
--cream:   #EDE8E0
--accent:  #C4773C
--sans:    'DM Sans', 'Noto Sans KR', sans-serif
--mono:    'IBM Plex Mono', monospace
```

## Project Structure

```
├── index.html              # Main single-page site
├── playground/
│   ├── index.html           # Standalone playground page
│   └── default-brick.png    # Default brick pattern image
├── api/
│   ├── chat.js              # AI chat serverless function
│   └── contact.js           # Contact form handler
├── assets/logo/             # SVG logos and favicon
├── vercel.json              # Vercel routing config
└── README.md
```

## Development

No dependencies. Open `index.html` in a browser or use any static server:

```bash
npx serve .
```

## Deploy

Deployed automatically via Vercel on push to `main`.

## Contact

- **Address**: Room 369, Daelim Arcade, 157 Eulji-ro, Jung-gu, Seoul, Korea 04543
- **Email**: architecture.algorithm@gmail.com
- **LinkedIn**: [tzung-kuan-hsu](https://www.linkedin.com/in/tzung-kuan-hsu/)
- **Instagram**: [@tzung_kuan_hsu](https://www.instagram.com/tzung_kuan_hsu/)

## License

&copy; 2026 AARO. All rights reserved.
