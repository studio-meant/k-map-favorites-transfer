# 라이브 정제 노트 (Task 8 / 11 라이브 단계용)

셀렉터를 채우고 실제 카카오/네이버에서 돌릴 때 반드시 점검·보정할 항목들.
구현 단계의 코드 리뷰에서 미리 식별한 forward-looking 이슈 모음이다.

## 동작상 가장 중요 (먼저 고칠 것)

1. **`existingPlaceNames` 호출 시점 (중복 판정의 핵심 결함)**
   - target 폴더 안 기존 장소를 읽는 로직은 반드시 타겟 폴더로 진입/선택한 뒤 실행되어야 한다.
     폴더 선택 전 페이지에서 기존 장소를 읽으면 특정 폴더 내용을 보여주지 않아 `existing`이 거의 항상 비고 dedup이 무력화된다.
   - **보정**: 타겟 폴더로 진입/선택한 *뒤에* 폴더별로 기존 장소를 읽도록 순서를 바꿀 것.

2. **이전 실행에서 이미 만든 폴더 처리**
   - `ensuredFolders`는 *이번 실행에서 생성한* 폴더만 추적함. 계정에 이미 존재하는 폴더(이전 실행 결과 등)는 "생성"과 "선택" 로직이 구분돼야 함.
   - 실제 저장 모달 구조를 보고 create-vs-select 분기를 맞출 것.

## 매칭 품질 (정확도 향상)

3. **검색 후보에 좌표가 없음 → 좌표 점수 분기가 죽어 있음**
   - `searchCandidates`는 후보를 `{name, address, _index}`로만 만든다. `match.mjs`의 좌표 가중치(0.3)가 write 경로에서 항상 미사용 → 사실상 name(0.7)+addr(0.3)만으로 매칭.
   - 타겟 검색 결과 DOM에 lat/lng가 노출되면 후보에 채워서 `MATCH_THRESHOLD=0.8`가 설계대로 동작하게 할 것.

4. **dedup이 이름만으로 판정됨 (≥0.85)**
   - `existingPlaceNames`가 `{name}`만 반환 → `isDuplicate`가 이름 분기만 사용. 기존 장소 DOM에 주소가 있으면 같이 캡처해 오판(스킵 누락/과스킵)을 줄일 것.
   - 관련: `match.mjs`의 `isDuplicate` 비대칭(한쪽만 좌표/한쪽만 주소면 false negative). 안전 방향(중복 놓침)이지만 데이터 형태 확인 후 튜닝.
   - `hasCoords`에 `Number.isFinite` 가드 추가 검토(파싱 오류로 NaN 유입 대비).

5. **완벽한 이름 일치인데 주소/좌표 없으면 `low_confidence`(0.7)로 떨어짐**
   - 동명 장소 오매칭 방지 위한 보수적 동작이나, 실제 데이터에서 잦으면 임계값/가중치 재조정 검토.

## 크롤링/검색 DOM 타이밍

6. **`autoScroll`의 스크롤 포트**
   - `scrollContainer`는 실제로 스크롤되는 요소를 가리켜야 함. 내부 리스트가 아니라 스크롤바가 부모에 있으면 no-op로 루프가 조기 종료됨. 실제 무한스크롤 컨테이너를 정확히 지정할 것.

7. **검색 결과 stale row**
   - `searchCandidates`는 입력을 비우고 다시 채우지만, 이전 검색 결과 row가 사라졌는지 확인하지 않고 `resultItem.count()`를 셈 → `_index`가 stale row를 가리킬 수 있음. 새 결과 로드 신호를 기다린 뒤 카운트할 것.

8. **SPA 로딩 대기**
   - `waitUntil: 'domcontentloaded'` 후 고정 `sleep`에 의존. 즐겨찾기 콘텐츠는 JS로 늦게 로드되므로, 가능하면 고정 sleep 대신 핵심 셀렉터 `waitForSelector`로 대체.

## 기타 (비차단)

9. `parseArgs`: 알 수 없는 플래그는 조용히 무시(`--form` 오타 등은 from=undefined로 잡히긴 함). 필요 시 `--help`/검증 추가.
