#!/usr/bin/env python3
"""Flow 댓글 쓰기 API 실측.

[댓글 쓰기 API 실측](../issues/15-comment-write-api-check.md) 티켓의 네 질문에 답할 시험 댓글을
개인 시험용 Flow 프로젝트의 시험 게시물에 올리고, 응답과 Flow에 저장된 내용을 결과 파일 하나로 남긴다.

- 개인 API 키는 FLOW_API_KEY 환경변수나 숨김 입력으로만 받는다. 파일이나 화면에 남기지 않는다.
- 시험 게시물은 동료가 남긴 PROBE-SETUP 댓글로 찾고, 댓글을 올리기 전에 사용자의 확인을 받는다.
- 결과 파일에서 나와 동료의 이름·ID는 별칭으로 바꾸고, 시험 댓글이 아닌 글은 글자를 가린다.
  알림 목록과 게시물 상세는 원문을 남기지 않는다. 알림 목록에는 다른 Flow 프로젝트의 글이 섞이기 때문이다.
- REST에는 댓글 삭제 API가 없다. 올린 시험 댓글은 Flow 화면에서 지우거나 시험 프로젝트째 지운다.

사용법: python3 -I flow-comment-write-probe.py [결과 파일 경로]
"""

import getpass
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

# Flow API 주소. 시험할 때는 FLOW_API_BASE로 로컬 모의 서버만 지정할 수 있다.
DEFAULT_BASE = "https://api.flow.team"
# 결과 파일 기본 경로.
DEFAULT_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "flow-comment-write-probe-result.json")
# 동료가 시험 게시물에 남기는 준비 댓글의 표지.
SETUP_MARKER = "PROBE-SETUP"
# 문서에 적힌 contents 최대 길이. 단위(글자·바이트)는 문서에 없다.
DOC_LIMIT = 4000
# 길이 시험에 채우는 글자. 한글 한 글자는 UTF-8로 3바이트라서 글자 단위와 바이트 단위가 갈린다.
FILL_CHAR = "가"
# 결과 파일에 원문 대신 길이 요약으로 남기는 문자열의 길이 기준.
LONG_TEXT = 300
# 429 응답 뒤 다시 보내기 전에 기다리는 최대 초.
MAX_RETRY_WAIT = 60
# 사람이 쓴 글을 담는 키. 시험 댓글이 아니면 글자를 가린다.
# 응답 봉투의 message는 오류 코드와 사유라서 넣지 않는다. 알림의 message는 알림 원문을 남기지 않으므로 상관없다.
TEXT_KEYS = {"content", "contents", "htmlContent", "outContent", "commentContent", "title", "fileName"}
# 게시물 상세의 remarks 항목에서 남길 키. 지운 댓글이 어떻게 표시되는지 보려고 남긴다.
REMARK_KEYS = ("COLABO_REMARK_SRNO", "COLABO_COMMT_SRNO", "DELETE_YN", "MODIFY_YN", "REPLY_CNT", "SYSTEM_REMARK_YN")
# 멘션 표기 `@[표시 이름](사용자 ID)`.
MENTION_RE = re.compile(r"@\[([^\]]+)\]\(([^)\s]+)\)")
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
URL_RE = re.compile(r"https?://[^\s\"'<>]+")


def scramble(text):
    """글자 종류만 남기고 내용을 지운다. 한글은 '가', 영문은 a/A, 숫자는 0이 된다."""
    out = []
    for ch in text:
        if "가" <= ch <= "힣":
            out.append("가")
        elif ch.isascii() and ch.isalpha():
            out.append("A" if ch.isupper() else "a")
        elif ch.isdigit():
            out.append("0")
        elif ch.isalpha():
            out.append("x")
        else:
            out.append(ch)
    return "".join(out)


def mask_url(url):
    """경로와 쿼리를 지운다. 사내 서버 주소가 새지 않도록 호스트는 Flow 도메인일 때만 남긴다."""
    parsed = urllib.parse.urlsplit(url)
    host = parsed.netloc if (parsed.hostname or "").endswith("flow.team") else "<가림>"
    return "%s://%s/<가림:%d자>" % (parsed.scheme, host, len(url))


def find_value(node, key):
    """응답 봉투의 깊이와 상관없이 key의 첫 값을 찾는다."""
    if isinstance(node, dict):
        if key in node:
            return node[key]
        children = node.values()
    elif isinstance(node, list):
        children = node
    else:
        return None
    for child in children:
        found = find_value(child, key)
        if found is not None:
            return found
    return None


def find_list(node, key):
    """응답 봉투의 깊이와 상관없이 key 이름의 첫 리스트를 찾는다."""
    if isinstance(node, dict):
        value = node.get(key)
        if isinstance(value, list):
            return value
        children = node.values()
    elif isinstance(node, list):
        children = node
    else:
        return None
    for child in children:
        found = find_list(child, key)
        if found is not None:
            return found
    return None


def data_of(body):
    """응답 봉투(`response.data`)의 data를 꺼낸다."""
    data = find_value(body, "data")
    return data if isinstance(data, dict) else {}


def same_id(a, b):
    """Flow 사용자 ID(이메일 형식)를 대소문자 구분 없이 비교한다."""
    return bool(a) and bool(b) and str(a).strip().lower() == str(b).strip().lower()


def iter_comments(body):
    """댓글 목록 응답에서 (글, 부모 댓글 ID) 쌍을 차례로 돌려준다. 댓글이면 부모는 None이다."""
    for comment in find_list(body, "comments") or []:
        yield comment, None
        for reply in comment.get("replies") or []:
            yield reply, str(comment.get("commentId"))


def item_key(item, parent_id):
    """댓글 ID와 대댓글 ID는 번호 체계가 달라 겹칠 수 있으므로 종류와 함께 키로 쓴다."""
    if parent_id is None:
        return ("comment", str(item.get("commentId")))
    return ("reply", str(item.get("replyId")))


def is_ok(status):
    return bool(status) and 200 <= status < 300


class Aliaser:
    """결과 파일에 쓰기 전에 사람을 알아볼 수 있는 값을 바꾼다."""

    def __init__(self, people):
        # 소문자로 바꾼 원래 값 → 별칭. 나와 동료의 ID·이름은 고정 별칭을 쓴다.
        self.known = {str(original).lower(): alias for original, alias in people if original}
        # 긴 값부터 한 번에 바꿔서, 바꾼 별칭이 다시 바뀌지 않게 한다.
        self.known_re = re.compile(
            "|".join(re.escape(k) for k in sorted(self.known, key=len, reverse=True)), re.IGNORECASE
        ) if self.known else None
        # 처음 보는 이메일 → 별칭.
        self.emails = {}

    def replace(self, text):
        """알려진 이름·ID와 처음 보는 이메일을 별칭으로, URL을 가린 주소로 바꾼다."""
        if self.known_re:
            text = self.known_re.sub(lambda m: self.known[m.group(0).lower()], text)
        text = URL_RE.sub(lambda m: mask_url(m.group(0)), text)
        return EMAIL_RE.sub(
            lambda m: self.emails.setdefault(m.group(0).lower(), "user%d@masked" % (len(self.emails) + 1)), text
        )

    def clean(self, node, key=None):
        """응답 전체를 재귀로 돌며 키에 맞는 규칙으로 값을 바꾼다."""
        if isinstance(node, dict):
            return {k: self.clean(v, k) for k, v in node.items()}
        if isinstance(node, list):
            return [self.clean(v, key) for v in node]
        if not isinstance(node, str) or not node:
            return node
        text = self.replace(node)
        # 길이 시험 댓글처럼 긴 글은 길이만 남긴다.
        if len(node) > LONG_TEXT:
            return {"$long": {"chars": len(node), "utf8Bytes": len(node.encode("utf-8")), "head": text[:40]}}
        # 이름 키: 나와 동료는 별칭이 되고, 그 밖의 이름·소속은 글자를 가린다.
        if key and key.endswith("Name"):
            return text if text != node else scramble(node)
        # 시험 댓글은 저장 형태를 봐야 하므로 그대로 두고, 그 밖의 글은 글자를 가린다.
        if key in TEXT_KEYS and "PROBE-" not in node.upper():
            return scramble(text)
        return text


class FlowClient:
    """Flow API 클라이언트. 호출 기록을 메모리에 쌓고, 결과 파일에는 가린 것만 쓴다."""

    def __init__(self, base, key):
        self.base = base.rstrip("/")
        self._key = key
        # 호출 기록. body는 원본이고, keep_body가 거짓이면 결과 파일에 쓰지 않는다.
        self.calls = []

    def call(self, method, label, path, query=None, payload=None, keep_body=True):
        url = self.base + path + ("?" + urllib.parse.urlencode(query) if query else "")
        # 앱(Electron의 JSON.stringify)처럼 한글을 이스케이프하지 않은 UTF-8로 보낸다.
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
        headers = {"x-flow-api-key": self._key, "Accept": "application/json"}
        if data is not None:
            headers["Content-Type"] = "application/json; charset=utf-8"
        for attempt in (1, 2):
            request = urllib.request.Request(url, data=data, method=method, headers=headers)
            started = time.monotonic()
            retry_after = None
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    status, raw = response.status, response.read()
            except urllib.error.HTTPError as error:
                status, raw = error.code, error.read()
                retry_after = error.headers.get("Retry-After")
            except (urllib.error.URLError, OSError) as error:
                status, raw = 0, json.dumps({"$networkError": str(error)}).encode("utf-8")
            elapsed = int((time.monotonic() - started) * 1000)
            # 429는 처리되지 않은 요청이므로 Retry-After만큼 기다렸다가 한 번만 다시 보낸다.
            if status == 429 and attempt == 1:
                wait = min(int(retry_after) if (retry_after or "").isdigit() else 5, MAX_RETRY_WAIT)
                print("  %-16s 429, %d초 뒤 다시 보냅니다." % (label, wait))
                time.sleep(wait)
                continue
            break
        try:
            body = json.loads(raw.decode("utf-8")) if raw else None
        except ValueError:
            body = {"$nonJson": raw[:300].decode("utf-8", "replace")}
        shown_path = path + ("?" + urllib.parse.urlencode(query) if query else "")
        at = datetime.now().strftime("%H:%M:%S")
        self.calls.append({"label": label, "method": method, "path": shown_path, "status": status,
                           "ms": elapsed, "at": at, "body": body, "keepBody": keep_body})
        print("  %-16s %-4s %s → %s (%dms)" % (label, method, shown_path, status or "응답 없음", elapsed))
        if status == 401:
            raise SystemExit("중단: 401 응답입니다. 개인 API 키를 확인해 주세요.")
        return status, body

    def post(self, label, post_id, contents, parent_id=None):
        """댓글(parent_id가 없을 때)이나 대댓글을 올리고, 결과를 시험 기록 하나로 돌려준다."""
        path = "/user/comments/%s" % post_id + ("/replies/%s" % parent_id if parent_id else "")
        status, body = self.call("POST", label, path, payload={"contents": contents})
        created = find_value(body, "replyId" if parent_id else "commentId") if is_ok(status) else None
        return {"case": label, "kind": "reply" if parent_id else "comment", "parentId": parent_id,
                "status": status, "id": str(created) if created is not None else None,
                "sentAt": self.calls[-1]["at"], "sent": contents, "response": body}

    def reply_or_skip(self, label, post_id, contents, parent):
        """부모 댓글을 올리지 못했으면 대댓글 시험을 건너뛴 기록을 남긴다."""
        if parent.get("id"):
            return self.post(label, post_id, contents, parent["id"])
        return {"case": label, "kind": "reply", "skipped": "부모 %s를 올리지 못했다" % parent["case"]}


def find_target(client):
    """동료의 준비 댓글로 시험 게시물과 나·동료의 이름과 ID를 찾는다."""
    # 준비 댓글이 만든 알림에서 시험 게시물을 찾는다. 알림 원문은 결과 파일에 남기지 않는다.
    _, body = client.call("GET", "setup_alarms", "/user/alarms", {"size": "100"}, keep_body=False)
    alarms = [a for a in find_list(body, "alarms") or [] if SETUP_MARKER in str(a.get("content") or "").upper()]
    me_id = None
    if alarms:
        newest = max(alarms, key=lambda a: str(a.get("registeredDateTime")))
        post_id, me_id = str(newest.get("postId")), newest.get("receiverId")
    else:
        print("알림 목록에서 %s 댓글을 찾지 못했습니다." % SETUP_MARKER)
        post_id = (os.environ.get("FLOW_PROBE_POST_ID") or input("시험 게시물의 postId를 알면 입력하세요(모르면 Enter로 중단): ")).strip()
        if not post_id:
            raise SystemExit("중단: 동료가 시험 게시물에 %s 댓글을 남겼는지 확인해 주세요." % SETUP_MARKER)

    status, post_body = client.call("GET", "setup_post", "/user/posts/%s" % post_id, keep_body=False)
    if not is_ok(status):
        raise SystemExit("중단: 시험 게시물을 조회하지 못했습니다(%s)." % status)
    status, comments_body = client.call("GET", "setup_comments", "/user/comments/%s" % post_id, {"replyYn": "Y", "size": "100"})
    if not is_ok(status):
        raise SystemExit("중단: 시험 게시물의 댓글을 조회하지 못했습니다(%s)." % status)
    post = data_of(post_body)
    # 알림 없이 postId를 받았으면 시험 게시물을 내가 썼다고 보고 작성자를 나로 쓴다. 확인 단계에서 사용자가 본다.
    me_id = me_id or post.get("registerId")

    # 동료의 준비 댓글. 여러 개면 가장 최근 것을 쓴다.
    setups = [item for item, _ in iter_comments(comments_body)
              if SETUP_MARKER in str(item.get("contents") or "").upper() and not same_id(item.get("registerId"), me_id)]
    if not setups:
        raise SystemExit("중단: 시험 게시물에 동료가 쓴 %s 댓글이 없습니다." % SETUP_MARKER)
    setup = max(setups, key=lambda item: str(item.get("registeredDateTime")))
    # 내 표시 이름은 동료가 Flow 화면에서 만든 멘션 표기에서 가져온다. 없으면 게시물 작성자 이름을 쓴다.
    me_name = next((name for name, mid in MENTION_RE.findall(setup.get("contents") or "") if same_id(mid, me_id)), None)
    if not me_name and same_id(post.get("registerId"), me_id):
        me_name = post.get("registerName")
    if not me_name:
        raise SystemExit("중단: 내 표시 이름을 찾지 못했습니다. 동료가 %s 댓글에서 나를 멘션해야 합니다." % SETUP_MARKER)
    return {
        "postId": post_id, "projectId": str(post.get("projectId")), "title": post.get("title"),
        "url": post.get("connectUrl"), "meId": me_id, "meName": me_name,
        "peerId": setup.get("registerId"), "peerName": setup.get("registerName"),
        "setupId": str(setup.get("replyId") or setup.get("commentId")), "setupContents": setup.get("contents"),
    }


def confirm(target, run):
    """실제 업무 게시물에 시험 글을 남기지 않도록, 올리기 전에 대상을 보여 주고 확인을 받는다."""
    print("\n시험 게시물")
    print("  Flow 프로젝트 ID %s, postId %s" % (target["projectId"], target["postId"]))
    print("  제목: %s" % target["title"])
    if target["url"]:
        print("  링크: %s" % target["url"])
    print("  나: %s (%s)" % (target["meName"], target["meId"]))
    print("  동료: %s (%s)" % (target["peerName"], target["peerId"]))
    print("\n이 게시물에 시험 댓글과 대댓글 13~15건을 올립니다. 표지 꼬리는 -%s입니다." % run)
    print("REST로는 지울 수 없으니, 실제 업무 프로젝트의 게시물이면 여기서 멈추세요.")
    if input("시험용 Flow 프로젝트의 게시물이 맞으면 yes를 입력하세요: ").strip().lower() != "yes":
        raise SystemExit("중단: 아무것도 올리지 않았습니다.")


def judge_length(attempts):
    """길이 시험 결과로 contents 최대 길이의 단위를 판단한다."""
    by_case = {a["case"]: a for a in attempts}
    over_chars, at_chars = by_case.get("T3-c4001"), by_case.get("T3-c4000")
    under_bytes, over_bytes = by_case.get("T3-bUnder"), by_case.get("T3-bOver")
    if over_chars and is_ok(over_chars["status"]):
        return "제한 없음", "4,001자도 받았다. 문서의 4,000 제한과 다르다. 저장된 길이를 확인한다."
    if at_chars and is_ok(at_chars["status"]):
        return "글자", "4,000자(%d바이트)는 받고 4,001자는 거절했다." % at_chars["utf8Bytes"]
    if under_bytes and over_bytes and is_ok(under_bytes["status"]) and not is_ok(over_bytes["status"]):
        return "바이트", "%d바이트는 받고 %d바이트는 거절했다." % (under_bytes["utf8Bytes"], over_bytes["utf8Bytes"])
    return "판단 불가", "응답 코드와 본문을 직접 확인한다."


def compare_stored(record, stored):
    """보낸 문자열과 Flow가 돌려주는 contents가 같은지 비교한다."""
    if not record.get("id"):
        return {"found": False, "reason": record.get("skipped") or "올리지 못했다"}
    item = stored.get(("reply" if record["kind"] == "reply" else "comment", record["id"]))
    if item is None:
        return {"found": False, "reason": "다시 조회한 목록에 없다"}
    contents = item.get("contents") or ""
    return {"found": True, "equalsSent": contents == record["sent"], "stored": contents,
            "newlinesSentStored": [record["sent"].count("\n"), contents.count("\n")]}


def resolve_base():
    base = os.environ.get("FLOW_API_BASE", DEFAULT_BASE)
    host = urllib.parse.urlsplit(base).hostname
    # 키가 엉뚱한 곳으로 가지 않도록 기본 주소 외에는 로컬 모의 서버만 허용한다.
    if base != DEFAULT_BASE and host not in ("127.0.0.1", "localhost"):
        raise SystemExit("FLOW_API_BASE는 %s 또는 로컬 주소만 쓸 수 있습니다." % DEFAULT_BASE)
    return base


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    base = resolve_base()
    key = (os.environ.get("FLOW_API_KEY") or getpass.getpass("Flow 개인 API 키(입력이 화면에 보이지 않습니다): ")).strip()
    if not key:
        raise SystemExit("키가 비어 있습니다.")
    client = FlowClient(base, key)
    del key
    # 표지 꼬리. 같은 시험 게시물에서 이전 실행의 시험 댓글과 구분한다.
    run = datetime.now().strftime("%H%M")

    def tag(case):
        return "PROBE-%s-%s" % (case, run)

    print("준비: 시험 게시물 찾기")
    target = find_target(client)
    confirm(target, run)
    post_id = target["postId"]
    comments_path = "/user/comments/%s" % post_id
    list_query = {"replyYn": "Y", "size": "100"}

    print("\n시험 댓글 올리기")
    # 질문 1: 받는 사람 표기가 멘션이 되는가. 동료가 멘션 알림과 다른 알림을 가를 수 있게 멘션 없는 대조 글을 함께 올린다.
    # T1A는 12에서 정한 게시 본문 형식(표기를 공백으로 잇고 같은 줄에서 본문을 잇는다) 그대로다.
    peer = "@[%s](%s)" % (target["peerName"], target["peerId"])
    me = "@[%s](%s)" % (target["meName"], target["meId"])
    t1a = client.post("T1A", post_id, "%s %s %s 받는 사람 두 명을 멘션한 새 댓글입니다." % (peer, me, tag("T1A")))
    t1b = client.post("T1B", post_id, "%s 멘션 없는 대조용 새 댓글입니다." % tag("T1B"))
    t1c = client.reply_or_skip("T1C", post_id, "%s %s 동료를 멘션한 대댓글입니다." % (peer, tag("T1C")), t1b)
    t1d = client.reply_or_skip("T1D", post_id, "%s 멘션 없는 대조용 대댓글입니다." % tag("T1D"), t1b)

    # 질문 2: 줄바꿈과 빈 줄. 마지막 줄은 Flow가 HTML이나 마크다운으로 해석하는지 덤으로 본다.
    t2 = client.post("T2", post_id, "\n".join([
        "%s 줄바꿈 시험" % tag("T2"),
        "첫째 문단 첫 문장입니다. 첫째 문단 둘째 문장입니다.",
        "",
        "둘째 문단입니다. 바로 위에 빈 줄이 하나 있어야 합니다.",
        "이 줄은 줄바꿈 하나로 이어졌습니다.",
        "",
        "특수문자: <b>꺾쇠 태그</b> & **별표 두 개** `백틱`",
    ]))
    t2r = client.reply_or_skip("T2R", post_id, "\n".join([
        "%s 대댓글 줄바꿈 시험" % tag("T2R"),
        "",
        "바로 위에 빈 줄이 하나 있어야 합니다.",
        "이 줄은 줄바꿈 하나로 이어졌습니다.",
    ]), t2)

    # 질문 4 준비: 사용자가 Flow 화면에서 지울 댓글. 실제 앱은 대댓글이 달린 스레드에 답하는 일이 많아 B에는 대댓글을 미리 단다.
    t4a = client.post("T4A", post_id, "%s 지울 댓글입니다(대댓글 없음). Flow 화면에서 지워 주세요." % tag("T4A"))
    t4b = client.post("T4B", post_id, "%s 지울 댓글입니다(대댓글 있음). Flow 화면에서 지워 주세요." % tag("T4B"))
    t4br = client.reply_or_skip("T4BR", post_id, "%s 지울 댓글에 미리 달아 둔 대댓글입니다." % tag("T4BR"), t4b)

    t1_times = sorted({r["sentAt"] for r in (t1a, t1b, t1c, t1d) if r.get("sentAt")})
    t1_when = "~".join(t1_times[:1] + t1_times[1:][-1:]) or "방금"
    print("\n[사용자 확인] 지금 Flow 웹에서 시험 게시물을 열고 아래를 해 주세요.")
    print("  1. 댓글 두 개를 지웁니다: %s, %s" % (tag("T4A"), tag("T4B")))
    print("     대댓글이 달린 댓글(%s)을 지울 때 Flow가 무엇을 묻거나 보여 주는지 기억해 둡니다." % tag("T4B"))
    print("  2. 동료에게 알림 확인을 부탁합니다.")
    print("     %s에 올린 PROBE-T1A~T1D 중 어떤 것이 알림으로 왔고, 알림 문구가 무엇인지 물어봅니다." % t1_when)
    input("다 했으면 Enter를 누르세요(지우지 못했으면 그대로 Enter): ")

    print("\n지운 댓글 확인과 길이 시험")
    # 질문 4: 지운 댓글이 조회에서 어떻게 보이는지 먼저 남기고, 그 아래에 대댓글을 단다.
    _, after_delete = client.call("GET", "T4_comments", comments_path, list_query)
    _, after_delete_post = client.call("GET", "T4_post", "/user/posts/%s" % post_id, keep_body=False)
    listed = {item_key(item, parent): item for item, parent in iter_comments(after_delete)}
    remarks = data_of(after_delete_post).get("remarks") or []
    q4 = {}
    for case, created in (("T4A", t4a), ("T4B", t4b)):
        if not created["id"]:
            q4[case] = {"skipped": "%s를 올리지 못했다" % case}
            continue
        status, replies = client.call("GET", "%s_replies" % case, "%s/replies/%s" % (comments_path, created["id"]))
        q4[case] = {
            "commentId": created["id"],
            "inListAfterDelete": ("comment", created["id"]) in listed,
            "listedItem": listed.get(("comment", created["id"])),
            "remarksInPost": [{k: r.get(k) for k in REMARK_KEYS if k in r}
                              for r in remarks if created["id"] in {str(v) for v in r.values()}],
            "repliesGet": {"status": status, "body": replies},
            "replyPost": client.post("%sX" % case, post_id, "%s 지운 댓글에 단 대댓글입니다." % tag(case + "X"), created["id"]),
        }
    if t4br.get("id"):
        q4["T4B"]["preReplyInListAfterDelete"] = ("reply", t4br["id"]) in listed

    # 질문 3: 길이 단위. 글자 기준 경계(4,001자 → 4,000자)를 먼저 보고, 4,000자가 거절되면 바이트 기준 경계를 본다.
    prefix = tag("T3") + " "
    prefix_bytes = len(prefix.encode("utf-8"))
    # 4,000바이트를 넘지 않는 가장 긴 채움 글자 수.
    fill_under_bytes = (DOC_LIMIT - prefix_bytes) // len(FILL_CHAR.encode("utf-8"))
    attempts = []

    def try_length(case, contents):
        record = client.post(case, post_id, contents)
        record.update({"chars": len(contents), "utf8Bytes": len(contents.encode("utf-8"))})
        record.pop("sent")
        attempts.append(record)
        return record

    try_length("T3-c4001", prefix + FILL_CHAR * (DOC_LIMIT + 1 - len(prefix)))
    if not is_ok(try_length("T3-c4000", prefix + FILL_CHAR * (DOC_LIMIT - len(prefix)))["status"]):
        try_length("T3-bUnder", prefix + FILL_CHAR * fill_under_bytes)
        try_length("T3-bOver", prefix + FILL_CHAR * (fill_under_bytes + 1))
    unit, unit_reason = judge_length(attempts)

    # 저장 형태 확인: 보낸 문자열과 Flow가 돌려주는 contents를 비교한다.
    _, final_comments = client.call("GET", "final_comments", comments_path, list_query)
    stored = {item_key(item, parent): item for item, parent in iter_comments(final_comments)}
    for record in attempts:
        item = stored.get(("comment", record["id"])) if record["id"] else None
        record["storedChars"] = len(item.get("contents") or "") if item else None
    # 질문 1 덤: 나를 멘션한 T1A가 내 멘션 알림을 만들었는가. 시험 게시물의 알림만 남긴다.
    _, final_alarms = client.call("GET", "final_alarms", "/user/alarms", {"filters": "MENTION", "size": "20"}, keep_body=False)
    self_alarms = [{k: a.get(k) for k in ("alarmId", "postId", "remarkId", "replyId", "mentionYn", "readYn", "registeredDateTime")}
                   for a in find_list(final_alarms, "alarms") or []
                   if str(a.get("postId")) == post_id and t1a["id"] and str(a.get("remarkId")) == t1a["id"]]

    mention_cases = [t1a, t1b, t1c, t1d]
    newline_cases = [t2, t2r]
    summary = {
        "q1Mention": {
            "uiMadeMentionBaseline": target["setupContents"],
            "posts": [dict(r, stored=compare_stored(r, stored)) for r in mention_cases],
            "selfMentionAlarmsForT1A": self_alarms,
        },
        "q2Newlines": {"posts": [dict(r, stored=compare_stored(r, stored)) for r in newline_cases]},
        "q3Length": {"unit": unit, "reason": unit_reason, "prefixChars": len(prefix), "attempts": attempts},
        "q4DeletedParent": dict(q4, preReply=t4br),
    }

    aliaser = Aliaser([(target["meId"], "me@masked"), (target["peerId"], "peer@masked"),
                       (target["meName"], "나"), (target["peerName"], "동료")])
    result = {
        "probe": "flow-comment-write-probe",
        "ranAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "run": run,
        "note": "나와 동료의 이름·ID는 나·동료·me@masked·peer@masked로 바꿨다. PROBE 표지가 없는 글은 글자를 가렸고, "
                "%d자를 넘는 문자열은 길이 요약으로 남겼다. 알림 목록과 게시물 상세의 원문은 남기지 않았다. sentAt은 PC 시각이다." % LONG_TEXT,
        "target": {"projectId": target["projectId"], "postId": post_id, "setupId": target["setupId"]},
        "summary": aliaser.clean(summary),
        "calls": [
            {k: (aliaser.clean(v) if k == "body" else v) for k, v in call.items() if k != "keepBody"}
            if call["keepBody"] else
            {k: v for k, v in call.items() if k not in ("body", "keepBody")}
            for call in client.calls
        ],
    }
    with open(out_path, "w", encoding="utf-8") as fp:
        json.dump(result, fp, ensure_ascii=False, indent=2)

    def stored_line(record):
        check = compare_stored(record, stored)
        if not check["found"]:
            return "%s: %s (%s)" % (record["case"], record.get("status", "건너뜀"), check["reason"])
        return "%s: %s, 저장 내용 %s, 줄바꿈 보냄 %d / 저장 %d" % (
            record["case"], record["status"], "같음" if check["equalsSent"] else "다름",
            *check["newlinesSentStored"])

    print("\nAPI로 본 결과")
    print("  질문 1. 멘션 표기")
    for record in mention_cases:
        print("    " + stored_line(record))
    print("    T1A가 만든 내 멘션 알림: %s" % ("있음" if self_alarms else "없음"))
    print("  질문 2. 줄바꿈")
    for record in newline_cases:
        print("    " + stored_line(record))
    print("  질문 3. 길이 단위: %s — %s" % (unit, unit_reason))
    for record in attempts:
        print("    %s(%d자, %d바이트): %s" % (record["case"], record["chars"], record["utf8Bytes"], record["status"]))
    print("  질문 4. 지운 부모 댓글에 대댓글")
    for case in ("T4A", "T4B"):
        info = q4.get(case, {})
        if "replyPost" in info:
            print("    %s: 삭제 뒤 목록에 %s, 대댓글 조회 %s, 대댓글 달기 %s" % (
                case, "있음" if info["inListAfterDelete"] else "없음", info["repliesGet"]["status"], info["replyPost"]["status"]))
        else:
            print("    %s: 건너뜀" % case)

    print("\n화면으로 확인해 주세요. 본 것을 에이전트에게 말로 알려 주시면 됩니다.")
    print("  1. 웹: 아래 두 글의 이름이 동료가 쓴 %s 댓글의 멘션처럼 보이나요, 아니면 @[이름](ID) 글자가 그대로 보이나요?" % SETUP_MARKER)
    print("     %s, %s" % (tag("T1A"), tag("T1C")))
    print("  2. 동료: PROBE-T1A~T1D 중 어떤 것이 알림으로 왔고, 알림 문구는 무엇인가요? (T1A·T1C는 멘션, T1B·T1D는 대조용)")
    print("  3. 웹과 데스크톱 앱: 줄바꿈 시험 댓글(%s)과 그 대댓글에서 빈 줄과 줄바꿈이 그대로 보이나요?" % tag("T2"))
    print("     특수문자 줄의 <b>, **, ` 기호는 글자 그대로 보이나요?")
    print("  4. 지운 댓글: 대댓글이 달린 댓글(%s)을 지울 때 Flow가 무엇을 보여 줬나요?" % tag("T4B"))
    print("     대댓글 달기가 2xx였다면 그 대댓글이 화면 어디에 보이나요?")
    print("\n결과 파일: %s" % out_path)
    print("가려지지 않은 이름이나 ID가 없는지 훑어본 뒤, 확인이 끝나면 시험 댓글이나 시험 프로젝트를 지워 주세요.")


if __name__ == "__main__":
    main()
