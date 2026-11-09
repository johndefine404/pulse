# pulse: 사람만 세는 방문 집계

[Define404]

방문자 숫자에 봇이 얼마나 섞였는지 확인해 보셨나요? pulse는 화면을 실제로 만진 사람만 따로 셉니다.

- 페이지를 연 접속과 스크롤·터치·클릭·키 입력을 한 사람을 나눠 셉니다
- 그 뒤 화면을 10초 넘게 띄워 둔 사람도 따로 셉니다
- 쿠키를 쓰지 않고, 접속 주소(IP)를 저장하지 않습니다
- Cloudflare Workers 하나로 돌아갑니다. 서버 코드 약 130줄, 화면 스크립트 1.5KB입니다
- 오픈소스(MIT)라 누구나 무료로 쓰고 고칠 수 있습니다

상태: v0.1. Define404 도구 8곳에서 실제로 쓰고 있습니다. 아래 "한계"를 꼭 읽어 주세요.

## 왜 만들었나

GA4 같은 방문 분석은 페이지가 열리면 방문 1건으로 셉니다. 작은 사이트는 자동 접속이 실제 방문보다 많은 날이 흔합니다.

예를 들어 2026-11-03부터 7일 동안 Define404의 한 서비스는 GA4 세션이 16건이었습니다. 세션당 참여 시간은 2초, 참여 비율은 12%였습니다. 숫자만 봐서는 사람이 몇 명이었는지 알 수 없습니다.

pulse는 브라우저 정보(User-Agent)로 봇을 거르는 대신, 사람이 화면을 만졌는지로 가립니다.

## 세는 것

| 신호 | 언제 보내나 | 집계 이름 |
|---|---|---|
| view | 페이지가 열릴 때 1번 | views(조회), visitors(조회한 방문자) |
| human | 처음 스크롤·터치·클릭·키 입력을 할 때 1번 | humans(사람) |
| engaged | human 뒤 화면이 보이는 상태로 10초가 지났을 때 1번 | engaged(10초 이상) |
| convert | 코드에서 `window.pulse("이름")`을 부를 때마다 | converts(전환) |

- 방문자는 브라우저 저장소(localStorage)의 무작위 값으로 구분합니다. 같은 사람이라도 기기나 브라우저가 다르면 다른 방문자입니다.
- 브라우저 정보(User-Agent)에 bot, crawl, headless, curl 같은 낱말이 있으면 그 접속의 신호는 모두 봇으로 따로 셉니다(bot_views). 사람·10초 이상·전환 숫자에는 넣지 않습니다.
- 기록은 13개월이 지나면 지웁니다.

## 설치

1. 이 저장소를 받고 `npm install`을 합니다.
2. `wrangler.toml`의 `[vars.SITES]`에 내 사이트 이름과 출처를 적습니다. 출처는 `https://`와 주소까지만 씁니다. 날짜를 자를 시간대는 `TZ_OFFSET_MINUTES`에 분으로 적습니다(서울 540).
3. 조회 열쇠를 정합니다: `npx wrangler secret put STATS_KEY`
4. 배포합니다: `npm run deploy`
5. `pulse.js`를 내 사이트에 올리고 페이지에 붙입니다.

```html
<script src="/pulse.js" data-endpoint="https://pulse.<내 서브도메인>.workers.dev/e" defer></script>
```

사이트가 보안 헤더(Content-Security-Policy)를 쓰면 `connect-src`에 pulse 주소를 넣어야 신호가 나갑니다.

전환을 세려면 그 순간에 부릅니다.

```js
window.pulse("signup_click");
```

## 숫자 보기

```bash
curl -H "Authorization: Bearer $STATS_KEY" "https://pulse.<내 서브도메인>.workers.dev/stats?days=14"
```

- `days`는 1부터 395까지입니다. 기본값은 14입니다.
- 사이트별로 날짜마다 views, visitors, humans, engaged, converts, bot_views를 돌려줍니다.
- 기간 안의 유입 경로(refs), 전환 이름(converts), 사람이 본 페이지(pages)를 상위 8개씩 함께 돌려줍니다.

방문자 한 명의 기록을 지우려면(삭제 요청 대응) 그 방문자의 `pulse_id` 값을 보냅니다.

```bash
curl -X POST -H "Authorization: Bearer $STATS_KEY" -H "content-type: application/json" \
  -d '{"vid":"<pulse_id>"}' "https://pulse.<내 서브도메인>.workers.dev/purge"
```

## 한계

- 출처 확인은 브라우저가 보내는 Origin 머리말을 봅니다. 브라우저가 아닌 프로그램은 이 값을 꾸며 보낼 수 있습니다. 그래서 숫자를 일부러 부풀리는 공격은 완전히 막지 못합니다.
- 기본 설정은 접속 주소 하나당 60초에 신호 60건까지 받습니다(`[[ratelimits]]`). 접속 주소는 세는 데만 쓰고 저장하지 않습니다. 이 한도가 필요 없으면 설정에서 빼면 됩니다.
- 화면을 만지는 자동화 도구는 사람으로 셀 수 있습니다. 대신 페이지만 여는 대부분의 봇은 걸러집니다.
- 저장소가 하나(Durable Object 1개)라 하루 수십만 건이 넘는 큰 사이트에는 맞지 않습니다. 작은 사이트 여러 곳을 묶어 보는 용도입니다.
- 화면(대시보드)이 없습니다. `/stats`가 돌려주는 숫자를 직접 읽거나 내 도구에서 씁니다.

## English

pulse is a tiny, cookie-free visit counter on one Cloudflare Worker. Instead of guessing bots from the User-Agent, it counts a visitor as human only after a real scroll, tap, click or key press, and as engaged after 10 more visible seconds. About 130 lines of server code and a 1.5 KB client script. Configure allowed origins in `wrangler.toml`, set `STATS_KEY`, deploy, then read `GET /stats` with `Authorization: Bearer <key>`. MIT licensed.

## 라이선스

MIT. 자세한 내용은 [LICENSE](LICENSE)를 봐 주세요.
