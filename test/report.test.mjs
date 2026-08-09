import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, formatReport } from '../lib/report.mjs';

const RESULT = {
  direction: 'kakao->naver',
  folders: [
    {
      name: '맛집',
      created: true,
      places: [
        { source: { name: 'A' }, status: 'transferred' },
        { source: { name: 'B' }, status: 'skipped_duplicate' },
        { source: { name: '스타벅스 어딘가점' }, status: 'low_confidence', matchScore: 0.6, matched: { name: '스타벅스 OO점' } },
        { source: { name: '친구네 집' }, status: 'not_found' },
        { source: { name: '에러집' }, status: 'error', note: '레이어 안 뜸' },
      ],
    },
  ],
};

test('summarize: 상태별 카운트 집계', () => {
  const s = summarize(RESULT);
  assert.equal(s.totalPlaces, 5);
  assert.equal(s.totalFolders, 1);
  assert.equal(s.counts.transferred, 1);
  assert.equal(s.counts.skipped_duplicate, 1);
  assert.equal(s.counts.low_confidence, 1);
  assert.equal(s.counts.not_found, 1);
  assert.equal(s.counts.error, 1);
});

test('formatReport: 옮김 성공/실패 계층 + 장소 리스트', () => {
  const text = formatReport(RESULT);
  assert.match(text, /## 📦 카카오맵 → 네이버맵 이전 결과/);
  assert.match(text, /### ✏️ 요약/);
  assert.match(text, /총 처리 장소: 5개/);
  // 옮김 성공 = transferred 1 + low_confidence 1 (확인 권장은 하위)
  assert.match(text, /✅ 옮김 성공 2개/);
  assert.match(text, /⚠️ 확인 권장 1개/);
  // 옮김 실패 = not_found 1 + error 1 (못 찾음·에러는 하위)
  assert.match(text, /❌ 옮김 실패 2개/);
  assert.match(text, /💢 못 찾음 1개/);
  assert.match(text, /⛔ 에러 1개/);
  // 확인 권장·못 찾음·에러 모두 장소 리스트도 요약에 표기
  assert.match(text, /스타벅스 어딘가점/);
  assert.match(text, /친구네 집/);
  assert.match(text, /에러집/);
});
