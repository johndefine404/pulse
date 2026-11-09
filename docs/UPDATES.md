# 업데이트 내역

## 2026-11-10

- 내부 방문 집계 서버를 오픈소스 저장소로 분리했다. 사이트 목록을 코드에서 설정(wrangler.toml [vars.SITES])으로 뺐고, 조회 열쇠를 주소 뒤가 아니라 Authorization 머리말로만 받게 바꿨다.
  - src/index.js, pulse.js, wrangler.toml(예시), README.md, LICENSE(MIT). 운영 설정은 wrangler.prod.toml 에 두고 git 에서 뺐다.
  - 바뀐 동작: /stats 는 열쇠가 없거나 틀리면 401(전에는 404), ?days=1~395 로 기간 지정(전에는 14일 고정). 기록 삭제는 GET ?purge_vid= 에서 POST /purge 로 옮겼다. 사람·10초 이상·전환 집계에서도 봇 접속을 뺐다. 신호 한 건 2KB 초과는 413. 날짜 시간대는 TZ_OFFSET_MINUTES.
  - 신호 받기에 호출 한도(접속 주소 하나당 60초 60건, 선택 설정)를 넣었다. 접속 주소는 세기만 하고 저장하지 않는다.
  - pulse.js 는 script 태그의 data-endpoint 로 받는 서버를 정한다. 예전 pulse.js 를 쓰는 사이트는 보내는 형식이 같아 그대로 동작한다.
- 빌드 표준 1단계: 화면 없는 집계 서버라 디자인 시스템은 만들지 않았다. 참고는 Plausible, Umami, GoatCounter, Cloudflare Web Analytics의 집계 방식(페이지 열림 기준)이고, pulse는 실제 조작 기준으로 사람을 가르는 점만 다르게 잡았다.
- 빌드 표준 2단계: 기능 = 화면 신호 받기(POST /e, 출처 목록 확인), 집계 조회(GET /stats), 방문자 기록 삭제(POST /purge). 데이터 = Durable Object SQLite 표 하나(ev). 인증 = 조회·삭제만 열쇠, 신호 받기는 출처 확인. 외부 연동 없음.
- 빌드 표준 3단계: Cloudflare Workers 무료 구간 안에서 돈다고 보고 월 0원으로 잡았다(실측 청구서 확인 아님). 검색 노출 대상 화면이 없어 렌더 방식 결정은 해당 없음. 기본 차단(목록에 없는 출처 403, 모르는 경로 404), 열쇠는 Workers 비밀값(STATS_KEY)에만 둔다.
- 빌드 표준 4단계: 배포 한 줄(npm run deploy:prod), 로그는 Workers observability 켬. 13개월 지난 기록 자동 삭제. 개발·운영 환경 분리는 하지 않았다(단일 집계 서버, 로컬은 wrangler dev).
- 빌드 표준 5단계: 로컬(wrangler dev)에서 점검 통과. 허용 출처 신호 204, 모르는 출처 403, 잘못된 종류 400, 2KB 초과 413, 열쇠 없음·주소 열쇠·틀린 열쇠 조회 401, 열쇠 없는 삭제 401, 없는 경로 404, 조회와 삭제 정상, curl 접속은 봇으로 분리. 운영 주소 점검 결과는 배포 뒤 아래에 적는다.
- 빌드 표준 6단계: 공개 화면이 없는 서버라 검색·AI 노출 작업은 해당 없음. 공개 문서는 README 하나다.
- 빌드 표준 7단계: 이 저장소 자체가 방문 집계라 GA4·서치 콘솔은 해당 없음.
