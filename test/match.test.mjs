import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, normalizeAddress, similarity } from '../lib/match.mjs';

test('normalizeName: 공백/기호 제거 + 소문자화', () => {
  assert.equal(normalizeName('스타벅스 강남 R점 (2층)'), '스타벅스강남r점2층');
  assert.equal(normalizeName('CGV  용산'), 'cgv용산');
});

test('normalizeAddress: 공백 제거', () => {
  assert.equal(normalizeAddress('서울 강남구 테헤란로 1'), '서울강남구테헤란로1');
});

test('similarity: 동일 문자열은 1', () => {
  assert.equal(similarity('스타벅스', '스타벅스'), 1);
});

test('similarity: 완전히 다르면 0에 가까움', () => {
  assert.ok(similarity('스타벅스', '맥도날드') < 0.2);
});

test('similarity: 부분 일치는 0과 1 사이', () => {
  const s = similarity('스타벅스강남점', '스타벅스강남역점');
  assert.ok(s > 0.6 && s < 1, `expected mid, got ${s}`);
});

import { haversineMeters, scoreCandidate } from '../lib/match.mjs';

test('haversineMeters: 같은 좌표는 0', () => {
  assert.equal(Math.round(haversineMeters(37.5, 127.0, 37.5, 127.0)), 0);
});

test('haversineMeters: 대략적인 거리 계산', () => {
  // 서울시청(37.5663,126.9779) ~ 강남역(37.4979,127.0276) 약 9km
  const d = haversineMeters(37.5663, 126.9779, 37.4979, 127.0276);
  assert.ok(d > 8000 && d < 10000, `got ${d}`);
});

test('scoreCandidate: 좌표 있으면 name/addr/coord 가중합', () => {
  const src = { name: '스타벅스 강남점', address: '서울 강남구 1', lat: 37.5, lng: 127.0 };
  const cand = { name: '스타벅스 강남점', address: '서울 강남구 1', lat: 37.5, lng: 127.0 };
  const r = scoreCandidate(src, cand);
  assert.ok(r.total > 0.99, `got ${r.total}`);
  assert.equal(r.coord !== null, true);
});

test('scoreCandidate: 좌표 없으면 name/addr만 사용', () => {
  const src = { name: '스타벅스 강남점', address: '서울 강남구 1' };
  const cand = { name: '스타벅스 강남점', address: '서울 강남구 1' };
  const r = scoreCandidate(src, cand);
  assert.equal(r.coord, null);
  assert.ok(r.total > 0.99, `got ${r.total}`);
});

test('scoreCandidate: 완전 다른 브랜드는 배제(이름 공유 없음)', () => {
  const src = { name: '스타벅스', address: '서울 강남구 테헤란로 1' };
  const cand = { name: '맥도날드', address: '부산 해운대구 우동 100' };
  const r = scoreCandidate(src, cand);
  assert.ok(r.total < 0.5, `got ${r.total}`);
});

test('scoreCandidate: 이름 애매해도 주소가 같으면 매칭(주소 최우선 정책)', () => {
  // 카카오 "스코프 부암점" vs 네이버 "부암동스코프베이커리" — 이름 0.43이지만 주소가 같은 곳.
  const src = { name: '스코프 부암점', address: '서울 종로구 창의문로 149 (부암동)' };
  const cand = { name: '부암동스코프베이커리', address: '서울 종로구 창의문로 149 1층' };
  const r = scoreCandidate(src, cand);
  assert.ok(r.total >= 0.5, `got ${r.total}`);
});

import { pickBestMatch, isDuplicate } from '../lib/match.mjs';

const SRC = { name: '스타벅스 강남점', address: '서울 강남구 테헤란로 1', lat: 37.5, lng: 127.0 };

test('pickBestMatch: 후보 없으면 not_found', () => {
  const r = pickBestMatch(SRC, []);
  assert.equal(r.status, 'not_found');
  assert.equal(r.candidate, null);
});

test('pickBestMatch: 고신뢰 후보는 transferred', () => {
  const cands = [
    { name: '스타벅스 강남점', address: '서울 강남구 테헤란로 1', lat: 37.5, lng: 127.0 },
    { name: '투썸 강남점', address: '서울 강남구 5', lat: 37.51, lng: 127.01 },
  ];
  const r = pickBestMatch(SRC, cands);
  assert.equal(r.status, 'transferred');
  assert.equal(r.candidate.name, '스타벅스 강남점');
  assert.ok(r.score >= 0.8);
});

test('pickBestMatch: 애매한 후보만 있으면 low_confidence', () => {
  const cands = [{ name: '스타벅스 역삼점', address: '서울 강남구 99', lat: 37.49, lng: 127.05 }];
  const r = pickBestMatch(SRC, cands);
  assert.equal(r.status, 'low_confidence');
  assert.ok(r.score < 0.8);
});

test('isDuplicate: 이름+좌표 근접하면 중복', () => {
  const existing = { name: '스타벅스 강남점', lat: 37.5001, lng: 127.0001 };
  assert.equal(isDuplicate(SRC, existing), true);
});

test('isDuplicate: 다른 장소면 false', () => {
  const existing = { name: '맥도날드 강남점', lat: 37.6, lng: 127.2 };
  assert.equal(isDuplicate(SRC, existing), false);
});

test('scoreCandidate: 같은 이름 다른 지역 → 주소(구/동·도로명) 일치하는 쪽이 높음', () => {
  const src = { name: '에뚜왈', address: '서울 강남구 압구정로10길 35 (신사동)' };
  const right = { name: '에뚜왈 가로수길점', address: '서울 강남구 압구정로10길 35' };
  const wrong = { name: '에뚜왈', address: '서울 구로구 고척동 100' };
  assert.ok(
    scoreCandidate(src, right).total > scoreCandidate(src, wrong).total,
    'full 주소가 일치하는 후보가 더 높아야 함'
  );
});
