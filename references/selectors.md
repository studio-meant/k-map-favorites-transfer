# 셀렉터 탐색 가이드

`config/selectors.mjs` 의 각 항목을 채우는 방법.

## 탐색 절차
1. `node scripts/discover.mjs kakao` (또는 naver) 실행 → 브라우저가 열린다.
2. 해당 서비스에 로그인하고 즐겨찾기 화면으로 이동한다.
3. 브라우저 DevTools(요소 검사)로 아래 항목의 셀렉터를 찾는다.
4. 터미널에서 Enter를 누르면 discover가 현재 페이지의 후보 구조를 덤프한다(보조 자료).
5. 찾은 셀렉터를 `config/selectors.mjs` 의 해당 서비스에 채운다.

## 채워야 할 항목 체크리스트
- loginCheck: 로그인 완료 시에만 보이는 요소 (프로필/내정보)
- scrape.folderItem / folderName / openFolder
- scrape.placeItem / placeName / placeAddress
- scrape.placeLat / placeLng (데이터 속성으로 좌표가 없으면 null로 두고 이름+주소만 사용)
- scrape.scrollContainer (무한스크롤이면 컨테이너, 아니면 null)
- write.searchInput / searchSubmit / resultItem / resultName / resultAddress
- write.saveButton / folderOption / newFolderButton / newFolderInput / newFolderConfirm
- write.existingFolderPlace (폴더 내 기존 장소 — 중복 판정용)

## 셀렉터 작성 팁
- 안정성 위해 `data-*`, `aria-label`, role 기반 셀렉터 우선. 동적 클래스명(해시)은 피한다.
- Playwright `getByRole`/`getByText` 로 대체 가능하면 그 텍스트를 메모로 남긴다.
- UI가 바뀌면 이 파일과 config/selectors.mjs 만 수정하면 된다.
