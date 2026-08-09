// 서비스별 URL/셀렉터 모음. 실제 값은 scripts/discover.mjs 로 탐색 후 채운다.
// null 인 항목을 사용하려 하면 requireSelector()가 명확한 에러를 던진다.

export const services = {
  kakao: {
    label: '카카오맵',
    favoritesUrl: 'https://map.kakao.com/',
    loginCheck: null,        // 로그인 완료를 판별할 셀렉터 (예: 내 프로필 아이콘)
    scrape: {
      folderItem: null,      // 폴더 1개를 가리키는 셀렉터
      folderName: null,      // 폴더 아이템 내부의 이름 텍스트
      openFolder: null,      // 폴더 클릭/펼치기
      placeItem: null,       // 폴더 안 장소 1개
      placeName: null,
      placeAddress: null,
      // 좌표 추출 방법(데이터 속성 또는 상세 진입). 없으면 null.
      placeLat: null,
      placeLng: null,
      scrollContainer: null, // 무한스크롤 컨테이너 (없으면 null -> window 스크롤)
    },
    write: {
      searchInput: null,     // 검색창
      searchSubmit: null,    // 검색 실행(엔터로 대체 가능하면 null)
      resultItem: null,      // 검색 결과 1개
      resultName: null,
      resultAddress: null,
      saveButton: null,      // 즐겨찾기 저장 버튼
      folderOption: null,    // 저장 시 폴더 선택 항목
      newFolderButton: null, // 새 폴더 만들기
      newFolderInput: null,
      newFolderConfirm: null,
      existingFolderPlace: null, // (선택) 폴더 내 기존 장소 목록 — 중복 판정용
    },
  },
  naver: {
    label: '네이버맵',
    favoritesUrl: 'https://map.naver.com/p/favorite/myPlace',
    loginCheck: null,
    scrape: {
      folderItem: null,
      folderName: null,
      openFolder: null,
      placeItem: null,
      placeName: null,
      placeAddress: null,
      placeLat: null,
      placeLng: null,
      scrollContainer: null,
    },
    write: {
      searchInput: null,
      searchSubmit: null,
      resultItem: null,
      resultName: null,
      resultAddress: null,
      saveButton: null,
      folderOption: null,
      newFolderButton: null,
      newFolderInput: null,
      newFolderConfirm: null,
      existingFolderPlace: null,
    },
  },
};

export function requireSelector(service, path) {
  const parts = path.split('.');
  let cur = services[service];
  for (const p of parts) cur = cur?.[p];
  if (cur == null) {
    throw new Error(
      `[selectors] '${service}.${path}' 가 아직 설정되지 않았습니다. ` +
        `scripts/discover.mjs 로 DOM을 탐색해 config/selectors.mjs를 채우세요.`
    );
  }
  return cur;
}
