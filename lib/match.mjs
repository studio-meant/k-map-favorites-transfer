// 순수 매칭 로직 — 브라우저/IO 의존 없음. 단위 테스트 대상.

export function normalizeName(s) {
  if (!s) return '';
  return s.replace(/[\s\-_,.()·!~|/\\\[\]]/g, '').toLowerCase();
}

export function normalizeAddress(s) {
  if (!s) return '';
  return s.replace(/[\s\-_,.()·]/g, '').toLowerCase();
}

function bigrams(s) {
  const out = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

// Sørensen–Dice 계수 (bigram 기반), 0..1
export function similarity(a, b) {
  if (a === b) return a ? 1 : 0;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  const counts = new Map();
  for (const g of A) counts.set(g, (counts.get(g) || 0) + 1);
  let inter = 0;
  for (const g of B) {
    const c = counts.get(g) || 0;
    if (c > 0) { inter++; counts.set(g, c - 1); }
  }
  return (2 * inter) / (A.length + B.length);
}

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function hasCoords(p) {
  return typeof p?.lat === 'number' && typeof p?.lng === 'number';
}

// 좌표 거리 -> 0..1 점수 (500m에서 0)
function coordScore(src, cand) {
  if (!hasCoords(src) || !hasCoords(cand)) return null;
  const d = haversineMeters(src.lat, src.lng, cand.lat, cand.lng);
  return Math.max(0, 1 - d / 500);
}

// full 주소를 단어 토큰 집합으로 보고 자카드(Jaccard) 유사도 계산: |교집합| / |합집합|
// 시/도 정식명 → 약칭 (카카오 "서울" ↔ 네이버 "서울특별시" 같은 표기 차이 흡수)
const SIDO_ALIAS = {
  서울특별시: '서울', 부산광역시: '부산', 대구광역시: '대구', 인천광역시: '인천',
  광주광역시: '광주', 대전광역시: '대전', 울산광역시: '울산', 세종특별자치시: '세종',
  경기도: '경기', 강원도: '강원', 강원특별자치도: '강원', 충청북도: '충북', 충청남도: '충남',
  전라북도: '전북', 전북특별자치도: '전북', 전라남도: '전남', 경상북도: '경북', 경상남도: '경남',
  제주특별자치도: '제주', 제주도: '제주',
};
export function addrJaccard(a, b) {
  const toks = (s) =>
    (s || '')
      .replace(/[(),.\[\]]/g, ' ')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => SIDO_ALIAS[t] || t);
  const A = new Set(toks(a));
  const B = new Set(toks(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  // 포함 관계: 짧은 쪽 토큰이 모두 긴 쪽에 들어있으면(한쪽 주소가 더 상세할 뿐 같은 장소) 1.0.
  // 단 짧은 쪽이 시/도+구+도로명+번지 수준(≥4토큰)일 때만 — 시·구까지만 겹치는 오매칭 방지.
  const minSize = Math.min(A.size, B.size);
  if (inter === minSize && minSize >= 4) return 1;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

// 주소 앞 두 토큰(시/도 + 시/군/구)이 같은지 — 시·도 약칭 정규화 후 비교. 다른 지역이면 false.
// (확인 권장 후보가 src와 시/구가 다르면 '다른 지역의 동명 가게'로 보고 옮기지 않기 위함)
export function sameRegion(a, b) {
  const toks = (s) =>
    (s || '').replace(/[(),.\[\]]/g, ' ').split(/\s+/).filter(Boolean).map((t) => SIDO_ALIAS[t] || t);
  const A = toks(a);
  const B = toks(b);
  if (A.length < 2 || B.length < 2) return true; // 주소 정보 부족하면 판단 보류(통과)
  return A[0] === B[0] && A[1] === B[1];
}

// 후보 1개에 대한 점수 분해 + 총점
// 정책(사용자 요청): full 주소 자카드(addr)가 점수를 '지배'한다. 이름은 완전히 다른 브랜드를
// 거르는 '최소 필터'로만 쓴다. (예: "스코프 부암점" vs "부암동스코프베이커리"는 이름 유사도 0.43으로
// 애매하지만 주소가 동일(창의문로 149) → 같은 가게이므로 매칭돼야 함.)
const NAME_MIN = 0.2; // 이름 유사도가 이 미만이고 포함관계도 아니면 '완전 다른 브랜드'로 보고 배제.
// 최소 필터 통과 여부: 한쪽이 다른 쪽을 포함하거나(지점 접미사 등) 유사도가 NAME_MIN 이상.
export function nameMatches(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na.length < 2 || nb.length < 2) return false;
  if (nb.includes(na) || na.includes(nb)) return true;
  return similarity(na, nb) >= NAME_MIN;
}
export function scoreCandidate(src, cand) {
  const ns = normalizeName(src.name);
  const nc = normalizeName(cand.name);
  const name = similarity(ns, nc);
  const addr = addrJaccard(src.address, cand.address); // full 주소 토큰 자카드 — 주신호
  const coord = coordScore(src, cand);
  const nameOk = nameMatches(src.name, cand.name); // 최소 필터: 완전 다른 브랜드만 배제
  let total;
  if (coord !== null) {
    total = 0.1 * name + 0.4 * addr + 0.5 * coord; // 좌표가 있으면 좌표가 가장 강한 신호
  } else if (addr >= 0.8) {
    total = addr; // 주소가 거의 일치(포함 관계 등) → 같은 장소 확실 → 이름 무시(영문/한글 이름차도 통과)
  } else if (!nameOk) {
    total = 0.3 * name; // 완전 다른 브랜드 — 주소가 우연히 겹쳐도 매칭하지 않음
  } else {
    total = 0.1 * name + 0.9 * addr; // 이름은 최소 신호, 주소(자카드)가 점수를 지배
  }
  return { name, addr, coord, total };
}

export const MATCH_THRESHOLD = 0.8;

// 후보 목록에서 최고점 선택 후 상태 분류
export function pickBestMatch(src, candidates, threshold = MATCH_THRESHOLD) {
  if (!candidates || candidates.length === 0) {
    return { status: 'not_found', candidate: null, score: 0, breakdown: null };
  }
  let best = null;
  for (const c of candidates) {
    const s = scoreCandidate(src, c);
    if (!best || s.total > best.breakdown.total) {
      best = { candidate: c, score: s.total, breakdown: s };
    }
  }
  best.status = best.score >= threshold ? 'transferred' : 'low_confidence';
  return best;
}

// 타겟 폴더에 이미 있는 장소인지 (멱등 보장용)
export function isDuplicate(src, existing) {
  const nameSim = similarity(normalizeName(src.name), normalizeName(existing.name));
  if (nameSim < 0.85) return false;
  if (hasCoords(src) && hasCoords(existing)) {
    return haversineMeters(src.lat, src.lng, existing.lat, existing.lng) <= 100;
  }
  const addrSim =
    src.address && existing.address
      ? similarity(normalizeAddress(src.address), normalizeAddress(existing.address))
      : 0;
  return addrSim >= 0.85;
}
