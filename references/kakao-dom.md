# 카카오맵 즐겨찾기 DOM (라이브 탐색 결과)

탐색일: 2026-06-03 / URL: https://map.kakao.com/ (로그인 후 MY 탭 → 즐겨찾기)

## 진입
- 좌측 메뉴 탭 `li#search.tab5`(MY) 클릭 → `div#info.my.FavoriteListView` 노출
- 서브탭 `li#my.subtab.favorite`(즐겨찾기) ACTIVE 상태에서 폴더 목록 표시

## 폴더(그룹) 목록 — READ
- 컨테이너: `div#my\.favorite .FavoriteBodyList > ul.list_detail`
- 폴더 아이템: `ul.list_detail > li.FavoriteDirectoryItem` (첫 항목 "기본 그룹"은 `li.FavoriteDirectoryItem.READONLY`)
- 폴더 이름: `li.FavoriteDirectoryItem strong[data-id="link"] a.link_txt`
- 폴더 내 개수: `.desc_directory .txt_refer .num` (첫 번째)
- 그룹 id: 내부 `input.inp_directory[id^="fav_"]` 의 value
- 총 23개 그룹 확인. 카테고리 필터 라벨에 "전체 N" 표시(`[data-id="label"] .num`)

## 폴더 상세(장소 목록) — READ
- **폴더 이름 `a.link_txt` 클릭 시, 같은 패널이 "상세"로 전환됨(navigate-in-place, 펼침 아님)**
- 상세 헤더: `.FavoriteDetailSummary > h4.tit_summary` = 폴더명
- 장소 아이템: `ul.list_detail > li.FavoriteDetailItem`
  - 장소명: `li.FavoriteDetailItem strong[data-id="link"] a.link_txt`
  - 주소: `li.FavoriteDetailItem .desc_region`
  - 장소 id: 내부 `input[id^="fav_"][data-type="item"]` 의 value
  - **좌표(lat/lng) 없음** → 매칭은 이름+주소만 사용
- 뒤로가기(폴더 목록 복귀): `a[data-id="detailBackBtn"].btn_back`
- 페이지네이션 (라이브 검증됨 — 성북동 181개로 확인):
  - **페이지당 100개**, 무한스크롤 아님(스크롤해도 100개에서 안 늘어남, `.FavoriteBodyList` 고정 높이).
  - 페이지 이동 = **페이지 번호 버튼** `[id="info.my.favorite.page.no{N}"]` 클릭 (no2 클릭 → 2페이지 81개로 전환 확인).
  - 사용 가능 페이지 = `HIDDEN` 클래스 없는 page.no 버튼(예: no1·no2만 보이면 2페이지). 현재 페이지 = `.ACTIVE`.
  - "다음" 버튼 `[id="info.my.favorite.page.next"]`은 페이지 번호 블록(5개) 초과 시에만 사용. 카카오 폴더 최대 500개 → 최대 5페이지 → no1~no5로 커버(다음 버튼 불필요).
  - 스크랩: 페이지 1 읽기 → HIDDEN 아닌 no2..noN을 순서대로 클릭하며 각 페이지의 `li.FavoriteDetailItem` 누적.

## 스크랩 절차 (navigate 모델)
1. 폴더 목록에서 모든 `li.FavoriteDirectoryItem`의 이름을 먼저 수집(클릭하면 목록이 사라지므로).
2. 각 폴더에 대해: 폴더 목록 화면 → 해당 폴더 `a.link_txt` 클릭 → 상세 전환 대기
3. 상세에서 `li.FavoriteDetailItem` 들 읽기(이름/주소). 페이지네이션 있으면 다음 페이지 반복.
4. `a[data-id="detailBackBtn"]` 클릭해 폴더 목록 복귀 → 다음 폴더.

## 설계 시사점
- 카카오는 폴더 클릭 시 상세 화면으로 전환되므로 **카카오 전용 스크랩 로직**(navigate + back + pagination)이 필요하다.
- 좌표 없음 → `placeLat/placeLng`는 사용 안 함.

## TODO (아직 미탐색)
- 카카오 WRITE 흐름(검색 → 결과 → 즐겨찾기 저장 → 그룹 선택/생성): naver→kakao 방향에서 필요.
