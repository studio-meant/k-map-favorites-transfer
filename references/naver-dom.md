# 네이버맵 즐겨찾기 DOM (라이브 탐색 결과)

탐색일: 2026-06-03 / URL: https://map.naver.com/p/favorite/myPlace

## ⚠️ 검증 못 한 것 (계정 데이터 부족)
이 계정은 네이버 폴더 3개·최대 12개 장소뿐이라 **페이지네이션/스크롤 로딩을 트리거할 수 없었음**:
- 폴더 목록(all-list iframe) 다수 폴더 시 페이징/스크롤 — 미검증 (헤더에 "다음" 화살표 `_right_area` 존재)
- 폴더→장소(detail-list) 다수 장소 시 페이징/스크롤 — 미검증
- 저장 위젯 폴더 리스트(`.swt-save-scroll-area`) 다수 폴더 시 스크롤 — 미검증
**영향**: 카카오→네이버 *쓰기*엔 거의 무관(아래). 네이버 *읽기*(역방향)엔 추후 데이터 많은 계정으로 확인 필요.
- 쓰기 dedup은 폴더 장소를 읽지 않고 **저장 위젯 체크 상태**로 처리 → 폴더→장소 페이징 불필요.
- 저장 위젯 폴더 목록은 타겟 폴더가 안 보일 수 있으니 writer가 **방어적으로 스크롤**해 찾을 것.

## 핵심 구조 (중요)
- 좌측 패널 `.panel_content#section_content` > `StyledFavoriteLayout` (styled-components, 해시 클래스)
- 상단: `.frequent_menu`(집/회사·자주가는곳·버스·지하철), 탭 `.tab_list`(장소/경로)
- **즐겨찾기 폴더 목록은 iframe 안에 있음** ⚠️
  ```html
  <iframe id="myPlaceBookmarkFolderListIframe"
    src="https://pages.map.naver.com/save-pages/pc/all-list?from=map&lang=ko&svcName=map_pcv5">
  ```
  - iframe은 `pages.map.naver.com` (메인은 `map.naver.com`) → 다른 서브도메인.
  - JS(same-origin)로는 iframe 내부 접근 불가. **Playwright `frameLocator`/`frame()`으로 접근**해야 함.
  - 폴더 리스트 URL: `https://pages.map.naver.com/save-pages/pc/all-list` (로그인 쿠키 공유 시 직접 접근도 가능할 수 있음)

## 시사점
- 네이버 스크랩/쓰기는 **iframe 컨텍스트**에서 동작해야 함 (Playwright frame 타게팅 필수).
- 클래스가 styled-components 해시(`StyledX-sc-xxxx`)라 불안정 → iframe 내부의 안정적 셀렉터(텍스트/구조/data-*)를 다시 탐색해야 함.
- 카카오(navigate-in-place)와도, 제네릭 scaffold와도 달라서 **네이버 전용 로직** 필요.

## 폴더 목록 — READ (iframe 내부, 확인됨)
- iframe: 메인 페이지의 `iframe#myPlaceBookmarkFolderListIframe` (Playwright frame으로 진입)
- 클래스는 CSS-module 해시(`_folder_list_item_14f5r_45` 등) → **prefix 부분매칭** 사용:
  - 폴더 아이템: `li[class*="_folder_list_item_"]`
  - 폴더 진입 버튼: `button[class*="_list_item_"]`
  - 폴더명: `span[class*="_name_"]` (예: 내 장소 / 강릉 / 케이크&디저트)
  - 장소 수: `_info_item_ _count_` → `span[class*="_count_"]`
  - 새 리스트 만들기: `button[class*="_new_list_"]`
  - 상단 필터: 전체/내/저장한 리스트 `button[class*="_list_btn_"]`, 정렬 `button[class*="_folder_list_btn_sort_"]`
- 확인된 폴더: 내 장소(12) · 강릉(3) · 케이크&디저트(1)

## 폴더 → 장소 목록 — READ (iframe 내부, 확인됨)
- 폴더 진입(`button[class*="_list_item_"]`) 클릭 시 iframe이 "상세 리스트"로 전환(`_detail_list_page_`)
- 폴더 제목: `h1[class*="_list_title_"]` / `strong[class*="_fixed_header_title_"]`
- 장소 카드 리스트: `ul[class*="_place_card_list_"]`
- 장소 카드: `li[class*="_place_info_card_"]` (role="button")
  - 장소명: `strong[class*="_main_title_"]` (느루 스테이 / 테라스마크 / 오르펜션)
  - 카테고리: `[class*="_category_title_"]` (펜션)
  - 주소: `[class*="_address_area_"] span` (강원특별자치도 강릉시 초당동 124-7)
  - 좌표 없음(이미지/주소만) → 이름+주소 매칭
- 폴더 목록 복귀: `button[class*="_view_all_list_btn_"]` ("전체 리스트 보기")
- 주의: 폐업/정보없는 장소 클릭 시 팝업(`_popup_` "폐업했거나 정보가 없는 장소입니다")

## ⚠️ 봇 탐지 / 세션 / rate-limit
- **IP 차단 발생(2026-06-03 21:00)**: "과도한 접근 요청으로 서비스 이용이 제한되었습니다"(IP 단위, 일시적).
  - **주원인은 탐색 도구의 과도한 폴링으로 추정**(원천 봉쇄가 아님): capture.mjs가 3초마다
    (스크린샷 + 즐겨찾기 iframe + 메인 프레임 + 전체 프레임 순회 + 장소 iframe) 평가를
    수 분간 + 재시작 여러 번 → 단시간 자동 요청 과다 → rate-limit 触발.
  - **대응(완료)**: 트리거 방식으로 전환(요청 시 1장만 캡처), 종료 시 clean close.
    저속·소량으로 접근하면 회피 가능성이 높음. IP 차단은 일시적이라 시간 지나면 해제됨.
  - 우회(IP 변경·탐지 회피)는 약관 위반이라 하지 않음.
- 네이버 로그인 시 **캡차(자동입력 방지 문자)** 가 뜰 수 있음(사람이 1회 해결).
- 교훈: 외부 서비스는 폴링하지 말고 **필요할 때만 1회 요청**. 실제 transfer도 요청 간 충분한 딜레이 필수.
- **세션이 재시작 간 유지되지 않음**: gitignore된 persistent 프로필을 써도, 캡처 재시작 시
  `nid.naver.com/nidlogin.login`으로 다시 튕기고 캡차를 다시 요구함.
  - 부분 원인: pkill(SIGTERM)로 종료하면 쿠키가 깨끗이 flush되지 않을 수 있음 →
    `process.on('SIGTERM', ...)`에서 `context.close()` 후 종료하면 개선 가능성.
  - 그러나 근본적으로 네이버가 자동화 세션을 짧게 만료/무효화하는 정황.
- **시사점**: 검색→저장을 반복하는 WRITE 자동화는 캡차/세션만료로 **중간에 막힐 위험이 큼**.
  "견고한 무인 자동 이전"이라는 목표가 네이버 쓰기 경로에서 특히 위협받음.
  → 저속·소량·사람이 캡차를 그때그때 풀어주는 반자동 형태가 현실적일 수 있음.

## 다중 iframe 구조 (메인 페이지)
- 즐겨찾기 폴더 목록: `iframe#myPlaceBookmarkFolderListIframe` (save-pages/pc/all-list)
- 폴더 상세(장소목록): `iframe#myPlaceBookmarkListIframe` (save-pages/pc/detail-list/<id>)
- 장소 상세(검색 결과 클릭 시): 별도 iframe (pcmap.place.naver.com 계열) — 저장 버튼이 여기 있을 것
- 즉 WRITE는 여러 프레임을 넘나들어야 함.

## 저장(북마크) 위젯 — WRITE (확인됨, 안정적 클래스 `swt-save-*`)
- 장소 상세 iframe(`pcmap.place.naver.com/place/<id>/home#bookmark`)에서 저장 버튼 클릭 시
  `#swt-save-widget-wrap` 안에 `.swt-save-list-view` 다이얼로그가 뜬다. (클래스 해시 아님 → 안정적)
- 저장 대상 장소명: `.swt-save-title-info-name` / 부가정보 `.swt-save-title-info-sub`
- 메모/별명/URL 추가: `button.swt-save-add-info-btn`
- **새 리스트 만들기**: `button.swt-save-group-add-btn`
- **폴더 목록**: `ul.swt-save-group-list > li.swt-save-group-item`
  - 폴더 토글 버튼: `button.swt-save-group-info` (role="checkbox") — 클릭하면 체크/해제
  - 폴더명: `strong.swt-save-group-name` (앞에 `span.swt-blind"폴더명"` 있으니 .textContent에서 trim)
  - 개수: `em.swt-save-group-count`
  - 체크상태: `.swt-save-group-check-area` 텍스트("선택해제됨"/체크아이콘 `.swt-icon-check`)
- **저장 커밋 버튼**: `button.swt-save-btn` (폴더 1개 이상 체크 전엔 `disabled`)
- 닫기: `.swt-close-btn`

### 네이버 WRITE 절차 (확정 부분)
1. (장소 진입) 검색 → 결과 클릭, 또는 `/p/entry/place/<id>` 직접 이동
2. 장소의 저장/북마크 버튼 클릭 → swt 위젯 노출
3. `li.swt-save-group-item` 중 `.swt-save-group-name`이 타겟 폴더명과 일치하는 항목의
   `button.swt-save-group-info` 클릭(체크). 없으면 `button.swt-save-group-add-btn`로 새 폴더 생성.
4. `button.swt-save-btn`(저장) 클릭.

## 검색 → 결과 목록 — (장소 진입용, 확인됨, ⚠️ 해시 클래스라 불안정)
- 검색 시 URL: `https://map.naver.com/p/search/<인코딩된 쿼리>`
- 결과 리스트는 iframe: `https://pcmap.place.naver.com/place/list?query=...` (검색 결과 전용)
- 결과 항목: `ul > li` (예: `li.VLTHu` — **해시 클래스, 빌드마다 바뀜**)
  - 썸네일 링크: `a.place_thumb` ("place_thumb"은 비교적 안정적 보임)
  - 이름: `span.YwYLL`류(해시) — **클래스 의존 금지**. 권장: 결과 `li` 내 클릭 가능한
    `a[role="button"]`의 텍스트(또는 가장 두드러진 텍스트 span)로 이름 추출.
  - 클릭: 이름 링크(`a[role="button"]`) 클릭 → 장소 상세(`/p/entry/place/<id>`)로 진입.
- ⚠️ **불안정**: 검색 결과 영역은 swt-save 위젯과 달리 해시 클래스 → 네이버 업데이트 시 재탐색 필요.
  견고화하려면 텍스트/구조 기반 셀렉터 + 휴리스틱(첫 결과 클릭) 사용.
- ⚠️ 검색 자동화는 rate-limit 유발 가능 → 저속·딜레이·소량 필수.

### 새 리스트 만들기 다이얼로그 (확인됨, 안정적 클래스)
- `button.swt-save-group-add-btn`(새 리스트 만들기) 클릭 → 위젯이 `.swt-save-folder-view`로 전환
- 폴더명 입력: `input#swt-save-input-folderview-list` (placeholder "새 리스트명을 입력해주세요.", max 20자) — **stable id**
- 색상 선택: `.swt-color-picker button.swt-color-picker-btn`(기본 `.swt-color-1` 선택됨) — 안 건드려도 됨
- 완료 버튼: `button.swt-complete-btn` (이름 입력 전엔 `disabled`)
- 완료 후 list-view로 복귀 → 새 폴더가 목록에 생김 → 체크 → `button.swt-save-btn`(저장)

### 네이버 WRITE 전체 절차 (확정)
1. 장소 진입: 검색→결과 클릭, 또는 `/p/entry/place/<id>` 직접 이동 (장소 상세 iframe `pcmap.place...#bookmark`)
2. 장소 iframe의 `a[href="#bookmark"]`(저장) 클릭 → `#swt-save-widget-wrap .swt-save-list-view` 노출
3. 타겟 폴더가 있으면: `li.swt-save-group-item`에서 `.swt-save-group-name` 일치 항목의 `button.swt-save-group-info` 클릭(체크)
   없으면: `button.swt-save-group-add-btn` → 위 다이얼로그로 폴더 생성 후 체크
4. `button.swt-save-btn`(저장) 클릭

### 저장 위젯 여는 버튼 (확인됨)
- 장소 상세 iframe(`pcmap.place`)의 툴바: `a[href="#bookmark"]` (텍스트 "저장", role=button, aria-pressed)
  - 클래스(`D_Xqt`)는 해시 → **`a[href="#bookmark"]`로 선택**(안정적). 이걸 클릭하면 swt 위젯이 열린다.

## ✅ 네이버 WRITE 셀렉터 전부 확보 (카카오→네이버에 필요한 것 완료)
남은 불안정 포인트는 검색 결과 목록(해시 클래스)뿐. 나머지(위젯/폴더/새리스트/저장 버튼)는 안정적.
