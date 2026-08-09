---
name: k-map-favorites-transfer
description: Use when the user wants an interactive local assistant to transfer saved-place favorites between Kakao Map (map.kakao.com) and Naver Map (map.naver.com). The skill opens a browser, asks transfer direction, has the user log in, crawls source folders for selection, safely copies selected folders to the target map, and reports transferred / already-present / low-confidence / not-found results.
---

# 카카오맵 ↔ 네이버맵 즐겨찾기 이전

카카오맵과 네이버맵의 "저장한 장소(즐겨찾기)" 폴더·장소를 한쪽에서 다른 쪽으로 옮긴다.

## 전제 / 리스크
- 두 서비스 모두 공개 API가 없어 **실제 브라우저를 자동 조작**한다. 실행 시 로컬 브라우저 창이 열리며 사용자가 직접 로그인해야 한다.
- 카카오/네이버 UI가 바뀌면 셀렉터(`config/selectors.mjs`)를 갱신해야 할 수 있다.
- 장소 매칭은 이름+주소(+좌표) 유사도 기반이라 오매칭/누락이 있을 수 있고, 그 내역은 리포트에 표시된다.
- 자동화는 약관 위반 소지가 있으므로 본인 데이터 이전·소량·저속으로만 사용한다.

## 사용자에게 반드시 물어볼 것
- 어디서 어디로 옮길지: `카카오맵 -> 네이버맵` 또는 `네이버맵 -> 카카오맵`.
- 로그인 완료 여부: 열린/재사용된 Chrome 지도 탭에서 source/target 지도에 각각 로그인했는지.
- 옮길 폴더: source 지도에서 읽어온 폴더 목록 중 어떤 폴더를 옮길지. 전체를 원하면 `전체`라고 받는다.
- 실행 전 최종 확인: 선택한 방향과 폴더가 맞는지.

## 사용자 안내 문구

아래 문구를 그대로 사용하거나, 사용자의 상황에 맞게 최소한으로만 바꿔 말한다. 톤은 친절하고 차분하게 유지한다.

### 시작 안내 + 방향 질문

> 안녕하세요! 환승지도 도우미입니다 :)
>
> 카카오맵과 네이버맵에 저장해둔 즐겨찾기 폴더를 로컬 Chrome 브라우저에서 안전하게 복사해드릴게요.
>
> 공식 저장 API가 없어서 제가 브라우저를 자동으로 조작하지만, 로그인은 사용자가 직접 열린 창에서 진행합니다. 계정 정보나 쿠키는 외부 서버로 보내지 않습니다.
>
> 먼저 어디서 어디로 옮기고 싶으신가요?
> - `카카오맵 -> 네이버맵`
> - `네이버맵 -> 카카오맵`

### 최초 설정 안내

> 처음 실행이라면 필요한 패키지와 Google Chrome 실행 환경을 준비할게요.
>
> 제가 `bash scripts/setup.sh`로 셋업을 먼저 확인해드릴게요.
>
> 그다음 Claude/Codex 안에서 끝까지 이어서 실행할 수 있도록 CDP 전용 Google Chrome을 준비하겠습니다.
>
> 이 Chrome은 `~/.map-transfer-chrome` 프로필을 사용해서 다음 명령에서도 로그인 세션이 유지됩니다. 지도 탭은 폴더 목록 조회를 시작할 때 열리거나, 이미 열려 있으면 재사용됩니다.

### 로그인 요청

> 이제 로그인이 필요해요. 제가 선택하신 방향으로 폴더 목록 조회를 시작해서 로컬 Google Chrome의 지도 탭을 열거나 기존 탭을 재사용할게요.
>
> 열린 탭에서 source 지도와 target 지도에 각각 로그인해 주세요. 스크립트가 source 폴더 목록을 감지하면 자동으로 목록을 출력하고 멈춥니다.
>
> 로그인 정보는 제가 입력하거나 저장하지 않고, 사용자의 로컬 브라우저 세션 안에서만 사용됩니다.

### 폴더 선택 요청

> source 지도에서 저장 폴더 목록을 읽어왔어요.
>
> 옮기고 싶은 폴더 번호나 이름을 알려주세요. 여러 개는 쉼표로 구분하면 됩니다.
>
> 예시:
> - `1`
> - `1,3,5`
> - `2-4`
> - 전체 폴더를 옮기려면 `전체`라고 알려주세요.

### 실행 전 최종 확인

> 선택하신 내용으로 이전을 시작할게요.
>
> 옮기는 중에는 target 지도에 새 폴더를 만들거나 장소를 저장할 수 있습니다. 이미 저장된 장소는 가능한 한 건드리지 않고 스킵하고, 애매한 매칭은 리포트에 따로 남기겠습니다.
>
> 준비되셨다면 시작하겠습니다.

### 완료 안내

> 이전이 끝났어요.
>
> 아래에는 폴더별 `report.md` 요약만 먼저 정리해드릴게요. 전체 상세 결과는 각 폴더의 리포트 파일에서 확인하실 수 있습니다.

### 폴더 목록이 비어 있을 때

> 폴더 목록을 읽어오지 못했어요.
>
> 열린 Chrome 창에서 source 지도 로그인이 완료되어 있는지, 저장 목록 화면이 정상적으로 보이는지 확인해 주세요. 확인 후 다시 시도하겠습니다.

## 기본 실행 절차
1. 먼저 `시작 안내 + 방향 질문` 문구로 설명하고, 카카오→네이버 / 네이버→카카오 중 어디서 어디로 옮길지 묻는다.
2. 최초 1회만 셋업한다: `bash scripts/setup.sh`.
3. 먼저 CDP Chrome을 **에이전트가 자동 실행**한다: `npm run chrome:cdp`.
   - 이 Chrome은 `~/.map-transfer-chrome` 프로필을 사용하므로 로그인 세션이 명령 사이에 유지된다.
   - 이미 CDP Chrome이 켜져 있으면 같은 창에 다시 연결한다.
4. 사용자가 선택한 방향에 맞춰 폴더 목록 조회를 **에이전트가 자동 실행**한다.
   - 카카오→네이버 폴더 조회: `npm run interactive -- --from kakao --to naver --list-folders`
   - 네이버→카카오 폴더 조회: `npm run interactive -- --from naver --to kakao --list-folders`
   - 실행 후 열린/재사용된 Chrome 탭에서 사용자가 source/target 서비스에 직접 로그인한다. 스크립트가 source 폴더 목록을 감지하면 목록을 출력하고 캐시한 뒤 종료한다.
5. 출력된 폴더 목록을 사용자에게 보여주고, 옮길 폴더 번호/이름 또는 `전체`를 묻는다.
6. 선택한 폴더에 맞춰 이전 명령을 **에이전트가 자동 실행**한다.
   - 번호/범위 선택: `npm run interactive -- --from kakao --to naver --select "1,3-5" --skip-closed-check`
   - 특정 폴더: `npm run interactive -- --from kakao --to naver --only "폴더명" --skip-closed-check`
   - 여러 폴더: `npm run interactive -- --from kakao --to naver --only "폴더1,폴더2" --skip-closed-check`
   - 전체 폴더: `npm run interactive -- --from kakao --to naver --all --skip-closed-check`
   - 네이버→카카오 방향도 `--from naver --to kakao`로 같은 방식으로 실행한다.
   - `--select`는 직전 `--list-folders`에서 저장한 폴더 캐시를 사용하므로, 사용자가 말한 번호를 그대로 넘길 수 있다.
7. 실행이 끝나면 콘솔의 폴더별 `## ... 이전 결과` 요약만 사용자에게 정리해서 말하고, 각 폴더의 `report.md` 절대 경로를 링크로 제공한다.

## 대화형 스크립트
- 기본: `npm run interactive`
- CDP Chrome 시작: `npm run chrome:cdp`
- 방향을 미리 지정: `npm run interactive -- --from kakao --to naver`
- 폴더 목록 조회: `npm run interactive -- --from kakao --to naver --list-folders`
- 특정 폴더 이전: `npm run interactive -- --from kakao --to naver --only "성북동" --skip-closed-check`
- 번호/범위 선택: `npm run interactive -- --from kakao --to naver --select "1,3-5" --skip-closed-check`
- 전체 폴더 이전: `npm run interactive -- --from kakao --to naver --all --skip-closed-check`
- 출력 폴더 지정: `npm run interactive -- --out out/my-run`
- 느리게 실행: `npm run interactive -- --delay 2500`

주의: 이 스킬은 CDP Chrome 전용이다. `npm run interactive`는 기본적으로 `http://127.0.0.1:9222`에 연결하므로, 항상 `npm run chrome:cdp`를 먼저 실행한다. stdin이 없는 Claude/Codex shell에서는 `--list-folders`, `--only`, `--select`, `--all` 중 하나를 반드시 붙인다.

대화형 스크립트는 선택한 source 폴더마다 별도 출력 폴더를 만들고 다음 파일을 남긴다.
- `places.json` — source에서 읽은 선택 폴더·장소
- `result.json` — target 처리 결과
- `report.md` — 상단 요약 + 전체 상세 표

## 산출물
- 기본 출력 위치는 `out/<방향>/<폴더명>/` 이다. 같은 폴더를 다시 실행하면 기존 `result.json`을 읽어 이어간다.
- `--out out/my-run`을 여러 폴더와 함께 쓰면 `out/my-run/<실제폴더명>/` 아래에 폴더별로 저장된다. 같은 `--out`으로 재실행하면 기존 `result.json`을 읽어 이어간다.
- `report.md` 상단의 `### ✏️ 요약` 섹션에는 총 소요 시간, 총 처리 장소, 이미 있음, 옮김 성공, 확인 권장, 못 찾음, 에러가 들어간다.
- 상세 표는 같은 `report.md` 아래에 폴더별로 이어진다.

## 문제 해결
- 실행 중 Chrome 창이 안 열리면 `npx playwright install chrome` 후 다시 실행한다.
- Chrome CDP에 연결하지 못하면 `npm run chrome:cdp`를 먼저 실행한다.
- 지도 탭이 여러 개 열려 있으면 스크립트는 기존 카카오/네이버 탭을 우선 재사용한다. 헷갈리면 오래된 지도 탭을 닫고 `npm run interactive -- --from kakao --to naver --list-folders`를 다시 실행한다.
- 카카오맵 source 장소 읽기가 한 장소에서 오래 멈춰 보이면 `--skip-closed-check`를 붙여 폐업/상세 진입 확인을 건너뛴다.
- 크롤링/저장이 비면 셀렉터가 깨진 것 → `references/selectors.md` 가이드로 `config/selectors.mjs` 갱신.
- source 폴더 목록이 비면 로그인 상태와 지도 UI를 확인한 뒤 다시 실행한다.
- 중단 후 재실행이 필요하면 같은 `--out` 경로를 지정해 기존 산출물을 보존하고 상황을 확인한다.
