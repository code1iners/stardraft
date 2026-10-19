// 앱 내 업데이트 실험용 로컬 서버. Vercel 함수 → GitHub 자산 호스트의 302 흐름을 흉내 낸다.
// - http://localhost:8001/feed/* : http://127.0.0.1:8002/* 로 302 한다. 호스트 이름이 달라 교차 출처 리디렉트가 된다.
// - http://localhost:8001/dl/*   : dl/ 폴더 파일을 그대로 내준다. Chrome으로 DMG를 받아 quarantine을 붙이는 용도다.
// - http://127.0.0.1:8002/*      : feed/ 폴더 파일을 그대로 내준다. 단일 Range를 지원한다.
// 모든 요청을 logs/server.log 에 JSON 한 줄씩 남긴다.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

/** 리디렉트를 하는 앞단 포트(Vercel 역할). */
const FRONT_PORT = 8001;
/** 파일을 내주는 뒷단 포트(GitHub 자산 호스트 역할). */
const ASSET_PORT = 8002;
/** 업데이트 피드 파일 폴더. */
const FEED_DIR = path.join(__dirname, 'feed');
/** 브라우저 다운로드용 DMG 폴더. */
const DL_DIR = path.join(__dirname, 'dl');
/** 요청 기록 파일. */
const LOG_PATH = path.join(__dirname, 'logs', 'server.log');

/** 요청 하나를 기록한다. */
function log(entry) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, `${line}\n`);
  console.log(line);
}

/** 확장자별 Content-Type. */
const CONTENT_TYPES = {
  '.yml': 'text/yaml',
  '.zip': 'application/zip',
  '.dmg': 'application/x-apple-diskimage',
  '.blockmap': 'application/octet-stream',
};

/** 폴더 안의 파일 하나를 응답으로 보낸다. 폴더 밖 경로와 없는 파일은 404다. */
function sendFile(req, res, root, relativePath, server) {
  /** 요청한 파일의 실제 경로. */
  const filePath = path.join(root, decodeURIComponent(relativePath));
  /** 요청 헤더 중 기록할 것. */
  const base = { server, method: req.method, url: req.url, range: req.headers.range, ua: req.headers['user-agent'] };

  // 폴더 밖이나 없는 파일이면 404.
  if (!filePath.startsWith(root + path.sep) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404).end();
    log({ ...base, status: 404 });
    return;
  }

  /** 파일 크기. */
  const size = fs.statSync(filePath).size;
  /** Content-Type. */
  const type = CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream';
  /** 단일 Range 요청 해석 결과. */
  const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');

  // 단일 Range면 206으로 일부만 보낸다. 다중 Range는 GitHub처럼 501로 거절한다.
  if (req.headers.range && !match) {
    res.writeHead(501).end();
    log({ ...base, status: 501 });
    return;
  }
  if (match) {
    /** 시작 바이트. */
    const start = match[1] === '' ? size - Number(match[2]) : Number(match[1]);
    /** 끝 바이트(포함). */
    const end = match[1] === '' || match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    log({ ...base, status: 206, bytes: end - start + 1 });
    return;
  }

  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
  // HEAD면 헤더만 보낸다.
  if (req.method === 'HEAD') {
    res.end();
  } else {
    fs.createReadStream(filePath).pipe(res);
  }
  log({ ...base, status: 200, bytes: size });
}

/** 앞단: /feed/* 는 302, /dl/* 는 파일, / 는 DMG 목록. */
function handleFront(req, res) {
  /** 요청 경로(쿼리 제외). */
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;

  if (pathname.startsWith('/feed/')) {
    /** 리디렉트 대상. */
    const location = `http://127.0.0.1:${ASSET_PORT}/${pathname.slice('/feed/'.length)}`;
    res.writeHead(302, { Location: location }).end();
    log({ server: 'front', method: req.method, url: req.url, range: req.headers.range, status: 302, location });
    return;
  }
  if (pathname.startsWith('/dl/')) {
    sendFile(req, res, DL_DIR, pathname.slice('/dl/'.length), 'front');
    return;
  }
  // DMG 목록을 링크로 보여 준다.
  /** dl/ 폴더의 DMG 이름들. */
  const names = fs.existsSync(DL_DIR) ? fs.readdirSync(DL_DIR).filter((name) => name.endsWith('.dmg')) : [];
  /** 목록 HTML. */
  const items = names.map((name) => `<li><a href="/dl/${encodeURIComponent(name)}">${name}</a></li>`).join('');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><title>UpdateProbe</title><h1>UpdateProbe DMG</h1><ul>${items}</ul>`);
  log({ server: 'front', method: req.method, url: req.url, status: 200 });
}

/** 뒷단: feed/ 폴더를 그대로 내준다. */
const assets = http.createServer((req, res) => {
  /** 요청 경로(쿼리 제외). */
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  sendFile(req, res, FEED_DIR, pathname.slice(1), 'assets');
});

// localhost가 IPv4와 IPv6 어느 쪽으로 풀려도 닿도록 둘 다 연다.
for (const host of ['127.0.0.1', '::1']) {
  http.createServer(handleFront).listen(FRONT_PORT, host, () => console.log(`front  http://localhost:${FRONT_PORT} (${host})`));
}
assets.listen(ASSET_PORT, '127.0.0.1', () => console.log(`assets http://127.0.0.1:${ASSET_PORT}`));
