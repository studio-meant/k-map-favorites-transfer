// 순수 리포트 생성 — result.json 객체를 받아 요약/텍스트 반환.

const DIRECTION_LABEL = {
  'kakao->naver': '카카오맵 → 네이버맵',
  'naver->kakao': '네이버맵 → 카카오맵',
};

const STATUSES = ['transferred', 'skipped_duplicate', 'low_confidence', 'not_found', 'no_address', 'closed', 'error'];

export function summarize(result) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  let totalPlaces = 0;
  for (const folder of result.folders ?? []) {
    for (const p of folder.places ?? []) {
      totalPlaces++;
      if (counts[p.status] !== undefined) counts[p.status]++;
    }
  }
  return { totalFolders: (result.folders ?? []).length, totalPlaces, counts };
}

export function formatReport(result) {
  const s = summarize(result);
  const dir = DIRECTION_LABEL[result.direction] ?? result.direction;
  const lines = [];
  const totalSec = (result.folders ?? [])
    .flatMap((f) => f.places ?? [])
    .reduce((sum, p) => sum + (p.elapsedSec || 0), 0);
  const timeStr = totalSec >= 60 ? `${Math.floor(totalSec / 60)}분 ${Math.round(totalSec % 60)}초` : `${Math.round(totalSec)}초`;
  lines.push(`## 📦 ${dir} 이전 결과`);
  lines.push('');
  lines.push('### ✏️ 요약');
  lines.push('');
  lines.push(`- 총 소요 시간: ${timeStr}`);
  lines.push(`- 총 처리 장소: ${s.totalPlaces}개`);
  // 옮김·이미있음·폐업은 카운트만, 확인 권장·못 찾음은 장소 리스트도 함께
  const byStatus = (st) => (result.folders ?? []).flatMap((f) => f.places ?? []).filter((p) => p.status === st);
  lines.push(`   - ⏭️ 이미 있음 ${s.counts.skipped_duplicate}개`);
  if (s.counts.closed > 0) lines.push(`   - 🗑️ 삭제/폐업 ${s.counts.closed}개`);
  // 옮김 = 정상 저장(transferred) + 확인 권장(low_confidence). 둘 다 실제로 저장됨 → 확인 권장은 옮김 하위에 표기.
  // 옮김 성공 = 정상 저장(transferred) + 확인 권장(low_confidence). 확인 권장은 하위에 표기.
  lines.push(`   - ✅ 옮김 성공 ${s.counts.transferred + s.counts.low_confidence}개`);
  if (s.counts.low_confidence > 0) {
    lines.push(`      - ⚠️ 확인 권장 ${s.counts.low_confidence}개`);
    for (const p of byStatus('low_confidence')) {
      lines.push(`        - "${p.source?.name}"`);
    }
  }
  // 옮김 실패 = 못 찾음(not_found) + 에러(error). 하위에 각각 장소 리스트.
  const failCount = s.counts.not_found + s.counts.error;
  if (failCount > 0) {
    lines.push(`   - ❌ 옮김 실패 ${failCount}개`);
    if (s.counts.not_found > 0) {
      lines.push(`      - 💢 못 찾음 ${s.counts.not_found}개`);
      for (const p of byStatus('not_found')) {
        lines.push(`        - "${p.source?.name}"`);
      }
    }
    if (s.counts.error > 0) {
      lines.push(`      - ⛔ 에러 ${s.counts.error}개`);
      for (const p of byStatus('error')) {
        lines.push(`        - "${p.source?.name}"`);
      }
    }
  }
  if (s.counts.no_address > 0) lines.push(`   - 📍 주소없음 ${s.counts.no_address}개`);
  return lines.join('\n');
}

// 장소별 상세 표(걸린 시간 + 유사도 점수 + 매칭된 곳) — 마크다운. 결과를 파일로 남길 때 사용.
const TABLE_LABEL = {
  transferred: '✅ 옮김',
  skipped_duplicate: '⏭️ 이미있음',
  low_confidence: '⚠️ 확인권장',
  not_found: '💢 못찾음',
  no_address: '📍 주소없음',
  closed: '🗑️ 폐업/삭제',
  error: '⛔ 에러',
};
// 상세 표 정렬 순서(최종 저장 시): 확인권장 → 못찾음 → 폐업 → 옮김 → 이미있음 → 주소없음 → 에러
const DETAIL_ORDER = ['low_confidence', 'not_found', 'error', 'closed', 'transferred', 'skipped_duplicate', 'no_address'];
export function formatDetailTable(result, sort = false) {
  const lines = [];
  // 방향에 따라 '출발(from)' 라벨: 카카오→네이버면 카카오, 네이버→카카오면 네이버
  const fromLabel = (result.direction || '').startsWith('naver') ? '네이버' : '카카오';
  const toLabel = fromLabel === '카카오' ? '네이버' : '카카오';
  for (const folder of result.folders ?? []) {
    lines.push(`### 📁 ${folder.name}`, '');
    lines.push('| 장소 | 매칭된 곳 | 상태 | 비고 |');
    lines.push('|---|---|---|---|');
    let rows = folder.places ?? [];
    if (sort) {
      const ord = (st) => { const i = DETAIL_ORDER.indexOf(st); return i < 0 ? 99 : i; };
      rows = [...rows].sort((a, b) => ord(a.status) - ord(b.status));
    }
    for (const p of rows) {
      const name = p.source?.name ?? '';
      const matched = p.matched?.name ? p.matched.name.replace(/\s+/g, ' ').slice(0, 28) : '—';
      const status = TABLE_LABEL[p.status] ?? p.status;
      // 비고: 확인 권장은 양쪽 주소(from/to), 못 찾음은 출발(from) 주소, 에러는 사유. (유사도는 안 적음)
      let note = '';
      if (p.status === 'low_confidence') {
        note = `${fromLabel}: ${p.source?.address ?? ''} / ${toLabel}: ${p.matched?.address ?? ''}`;
      } else if (p.status === 'not_found') {
        // 검색 0건이면 출발 주소만, 시/구 불일치로 거른 경우(matched 있음)는 양쪽 주소
        note = p.matched?.address
          ? `${fromLabel}: ${p.source?.address ?? ''} / ${toLabel}: ${p.matched.address}`
          : `${fromLabel}: ${p.source?.address ?? ''}`;
      } else if (p.status === 'error') {
        note = `${fromLabel}: ${p.source?.address ?? ''}`;
      }
      lines.push(`| ${name} | ${matched} | ${status} | ${note} |`);
    }
    lines.push(''); // 폴더 간 구분 (카운트 요약은 상단 ✏️ 요약에 있으므로 생략)
  }
  return lines.join('\n');
}
