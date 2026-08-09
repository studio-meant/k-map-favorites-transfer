<h1 align="center">💔 — 환승지도 — 🗺️</h1>

<p align="center">
  <strong>카카오맵과 네이버맵의 저장한 장소, 즐겨찾기 폴더를 로컬 브라우저에서 안전하게 복사하는 AI 에이전트용 스킬입니다.</strong>
</p>

<p align="center">
  지도 앱을 갈아타고 싶은데, 한쪽 지도에 오래 쌓아둔 맛집, 카페, 여행지, 생활 장소 때문에 꽤 오래 갈아타지 못하고 있었습니다.<br>
  이젠 갈아탈 때가 된 것 같아, 이 장소들을 빠르고 편리하게 옮길 수 있는 도구를 만들었습니다.
</p>

<p align="center">
  <a href="#demo">Demo</a> ·
  <a href="#why">Why</a> ·
  <a href="#what-it-does">What it does</a> ·
  <a href="#install--usage">Install & Usage</a> ·
  <a href="#faq">FAQ</a>
</p>

---

## Demo

- [카카오맵 -> 네이버맵 결과 리포트 예시 바로가기](out/k_to_n/성북동/report.md)
- [네이버맵 -> 카카오맵 결과 리포트 예시 바로가기](out/n_to_k/성북동-역방향/report.md)

https://github.com/user-attachments/assets/95c655cc-b3d0-4887-9524-fc57265a1d6b

---

## Why

지도 앱에 저장한 장소는 취향, 생활 동선, 여행 기억이 쌓인 개인 기록입니다. 앱을 바꾸는 일은 새 앱을 설치하는 것보다, 그동안 쌓아둔 장소를 다시 옮기는 일이 더 큰 장벽이 되곤 합니다.

`환승지도`는 이 전환 비용을 낮추기 위해 만들었습니다. 한 지도에 묶여 있던 즐겨찾기 폴더와 장소를 다른 지도에서도 다시 쓸 수 있게 옮겨 주는, 개인용 지도 환승 도우미입니다.

일반적인 방법은 번거롭습니다.

- 폴더를 하나씩 열고 장소명을 복사한다.
- 다른 지도에서 다시 검색한다.
- 같은 장소인지 주소를 확인한다.
- 새 폴더를 만들고 저장한다.
- 못 찾은 장소는 따로 기록한다.

`환승지도`는 이 과정을 로컬 브라우저 자동화로 묶습니다. 사용자는 어디서 어디로 옮길지 고르고, 로그인하고, source 지도에서 가져온 폴더 목록 중 옮길 폴더를 선택하면 됩니다.

---

## What it does

현재 지원하는 기능:

| 기능 | 설명 |
|---|---|
| 카카오맵 -> 네이버맵 | 카카오맵 즐겨찾기 폴더와 장소를 네이버맵 저장 리스트로 복사 |
| 네이버맵 -> 카카오맵 | 네이버맵 저장 리스트를 카카오맵 즐겨찾기 그룹으로 복사 |
| 폴더 선택 | source 지도에서 폴더 목록을 먼저 읽고, 사용자가 옮길 폴더를 선택 |
| 안전 매칭 | 장소명과 주소 기반으로 후보를 비교 |
| 중복 방지 | target 폴더에 이미 저장된 장소는 건드리지 않고 스킵 |
| 결과 리포트 | 옮김 성공, 이미 있음, 확인 권장, 못 찾음, 에러를 `report.md`로 저장 |

실행 결과는 폴더별로 저장됩니다.

```text
out/<방향>/<폴더명>/
```

예:

```text
out/k_to_n/베이커리-역방향/
out/k_to_n/해방촌도장깨기-역방향/
out/n_to_k/성북동-역방향/
```

생성 파일:

| 파일 | 설명 |
|---|---|
| `places.json` | source 지도에서 읽은 폴더와 장소 원본 |
| `result.json` | 각 장소의 처리 상태 |
| `report.md` | 사람이 읽기 쉬운 요약과 상세 표 |

하지 않는 일:
- source 지도에 장소와 함께 저장된 '메모' 정보는 복사하지 않습니다. (추후 지원 예정)
- target 지도에서 장소를 삭제하지 않습니다.
- target 폴더명을 바꾸지 않습니다.
- CAPTCHA 우회나 대량 수집을 지원하지 않습니다.
- 클라우드 서버에서 사용자의 지도 계정 로그인을 대신 처리하지 않습니다.

---

## Install & Usage

먼저 준비해 주세요:

- Node.js 18 이상
- npm
- Google Chrome
- 카카오맵/네이버맵 계정

### 1) AI 에이전트에서 실행

Codex에서 쓰려면 `$CODEX_HOME/skills` 또는 `~/.codex/skills` 아래에 clone합니다.

```bash
git clone https://github.com/studio-meant/k-map-favorites-transfer.git "${CODEX_HOME:-$HOME/.codex}/skills/k-map-favorites-transfer"
```

Claude Code에서 쓰려면 `~/.claude/skills` 아래에 clone합니다.

```bash
git clone https://github.com/studio-meant/k-map-favorites-transfer.git ~/.claude/skills/k-map-favorites-transfer
```

스킬을 처음 실행하면 필요한 패키지 설치와 Google Chrome 준비를 확인합니다.

설치 후 Codex나 Claude Code에서 자연어로 요청합니다.

```text
카카오맵 즐겨찾기를 네이버맵으로 옮겨줘.
```

```text
네이버맵 저장 리스트 중 성북동 폴더만 카카오맵으로 옮겨줘.
```

이후 에이전트가 안내하는 질문에 따라 지도 방향을 고르고, 열린 Chrome 창에서 직접 로그인한 뒤 옮길 폴더를 선택하면 됩니다.

### 2) 터미널에서 대화형 실행

AI 에이전트 없이 터미널에서 직접 실행할 수도 있습니다.

```bash
git clone https://github.com/studio-meant/k-map-favorites-transfer.git
cd k-map-favorites-transfer
bash scripts/setup.sh
```

이 스킬은 CDP Chrome 전용이므로 먼저 `npm run chrome:cdp`를 실행합니다. 옵션 없이 `npm run interactive`만 실행하면 로그인 확인, 폴더 선택, Enter 입력이 필요하므로 macOS Terminal, iTerm, VS Code Terminal 같은 실제 대화형 터미널에서 실행해야 합니다.

```bash
npm run chrome:cdp
npm run interactive
```

방향을 미리 지정할 수도 있습니다.

```bash
npm run interactive -- --from kakao --to naver
npm run interactive -- --from naver --to kakao
```

---

## FAQ

### 이건 공식 카카오/네이버 API를 쓰나요?

아니요. 두 서비스의 개인 저장 장소와 폴더를 읽고 쓰는 공개 API가 없기 때문에, 로그인된 로컬 브라우저 화면을 자동 조작합니다.

### 계정 정보가 저장되나요?

스킬은 사용자의 비밀번호를 입력받지 않습니다. 로그인은 열린 브라우저 안에서 사용자가 직접 합니다.

CDP Chrome은 `~/.map-transfer-chrome` 프로필을 사용합니다. 세션을 남기고 싶지 않으면 실행 후 해당 폴더를 삭제하세요. 폴더 번호 선택용 캐시는 `~/.map-transfer-cache`에 저장됩니다.

```bash
rm -rf ~/.map-transfer-chrome
rm -rf ~/.map-transfer-cache
```

### 평소 쓰는 Chrome 로그인 세션이 그대로 유지되나요?

아니요. 스킬은 평소 쓰는 Chrome 프로필이 아니라 `~/.map-transfer-chrome` 전용 프로필을 엽니다. 그래서 일반 Chrome에 로그인되어 있어도 처음에는 다시 로그인이 필요할 수 있습니다.

대신 한 번 로그인하면 이후 `npm run chrome:cdp`와 `npm run interactive` 실행에서 같은 전용 프로필을 계속 재사용합니다.

### 자동화라서 위험하지 않나요?

공식 API가 아닌 브라우저 자동화이므로 약관 및 계정 제한 리스크가 있습니다. 본인 데이터 이전, 소량, 저속 실행 용도로만 사용하세요.

### 폴더 목록이 비어 있으면 어떻게 하나요?

브라우저에서 로그인이 완료되었는지 확인하세요. 지도 UI가 바뀐 경우 `references/kakao-dom.md`, `references/naver-dom.md`, `references/selectors.md`를 보고 selector를 갱신해야 할 수 있습니다.

지도 탭이 여러 개 열려 있어 헷갈리면 오래된 카카오/네이버 탭을 닫고 다시 실행하세요. 스크립트는 기존 카카오/네이버 탭을 우선 재사용하고, 없을 때만 새 탭을 엽니다.

### 중간에 멈추면 다시 처음부터 해야 하나요?

같은 `--out` 경로로 다시 실행하면 기존 `result.json`을 읽어 이미 처리된 항목을 이어받습니다.

```bash
npm run interactive -- --from kakao --to naver --out out/my-transfer
```

카카오맵에서 장소 하나를 읽는 단계가 오래 걸리면 폐업/상세 진입 확인에서 멈춘 것처럼 보일 수 있습니다. 이때는 `--skip-closed-check`를 붙여 먼저 이전을 진행하고, 애매한 항목은 리포트에서 확인하세요.

### 전체 폴더를 한 번에 옮길 수 있나요?

폴더 선택 단계에서 Enter를 누르면 전체 폴더를 선택합니다. 장소가 많으면 시간이 오래 걸리고 자동화 감지 위험이 커질 수 있으니 처음에는 작은 폴더로 테스트하는 것을 권장합니다.
