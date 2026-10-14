#!/usr/bin/env python3
"""Flow 알림 API 실호출 점검.

[Flow 알림 API 실호출로 멘션 데이터 확인](../issues/01-flow-alarm-api-check.md) 티켓의
질문에 답할 응답을 모으고, 이름·이메일·본문 글자를 가린 결과 파일 하나로 남긴다.

- 개인 API 키는 FLOW_API_KEY 환경변수나 숨김 입력으로만 받는다. 파일이나 화면에 남기지 않는다.
- GET만 호출한다. 읽음 처리 API(PATCH /user/alarms/read*)는 부르지 않는다.
- 원본 응답은 메모리에만 두고, 가린 결과만 디스크에 쓴다.

사용법: python3 -I flow-alarm-probe.py [결과 파일 경로]
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
DEFAULT_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "flow-alarm-probe-result.json")
# 멘션 본문 맨 앞에 넣는 식별 표지. 가리지 않고 남겨서 어느 알림이 어느 멘션인지 구분한다.
MARKER_RE = re.compile(r"PROBE-[A-Z]+", re.IGNORECASE)
# 기대하는 표지와 그 멘션이 일어난 위치.
EXPECTED_MARKERS = {
    "PROBE-POST": "업무 게시물 본문",
    "PROBE-COMMENT": "업무 댓글",
    "PROBE-REPLY": "업무 대댓글(선택)",
    "PROBE-GROUP": "그룹·프로젝트 채팅방",
    "PROBE-DM": "1:1 채팅",
}
# 상세를 조회할 게시글 수 상한.
MAX_POSTS = 3
# 알림 목록 한 번 조회에서 따라갈 페이지 수 상한.
MAX_ALARM_PAGES = 3
# 응답 요약에 남길 알림 필드.
ALARM_FIELDS = (
    "alarmId", "alarmType", "mentionYn", "registrantYn", "workerYn", "readYn",
    "projectId", "postId", "remarkId", "replyId", "registeredDateTime",
)
# 값이 없음을 뜻하는 ID 값.
EMPTY_IDS = ("", "-1", "0", "None")
# 사람이 쓴 글을 담는 키. 짧은 영문이어도 가린다.
TEXT_KEYS = {"message", "content", "htmlContent", "contents", "title", "text", "body", "fileName", "fileContents"}
# "~Name" 키 중 사람 이름이 아닌 것. 이름 별칭 대신 글자 가리기를 적용한다.
NON_PERSON_NAME_RE = re.compile(r"file|attach|corp|division|dept|contents|project|room", re.IGNORECASE)
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
URL_RE = re.compile(r"https?://[^\s\"'<>]+")
HTML_TAG_RE = re.compile(r"(</?[A-Za-z][^<>]*>)")
HTML_ENTITY_RE = re.compile(r"&(?:[A-Za-z]+|#\d+|#x[0-9A-Fa-f]+);")
TAG_ATTR_RE = re.compile(r"([\s/])([\w:-]+)(\s*=\s*)(\"[^\"]*\"|'[^']*'|[^\s>]+)")
# 알림 메시지 템플릿 안에서 따옴표·괄호로 감싼 부분(게시물 제목 등).
QUOTED_RE = re.compile(r"(['\"“‘「『\[])(.+?)(['\"”’」』\]])")
# 태그 속성 중 값을 그대로 남겨도 되는 것(구조 정보).
KEEP_ATTRS = {"class", "style", "type", "target", "rel", "contenteditable", "spellcheck", "dir"}
# 가린 글자 사이에 끼워 두는 자리표시자의 경계 문자(사용자 영역 유니코드).
PH_OPEN, PH_CLOSE, PH_BASE = "\ue000", "\ue001", 0xE100


def scramble(text):
    """글자 종류만 남기고 내용을 지운다. 한글은 '가', 영문은 a/A, 숫자는 0이 된다."""
    out = []
    for ch in text:
        if "가" <= ch <= "힣":
            out.append("가")
        elif "ㄱ" <= ch <= "ㆎ":
            out.append("ㄱ")
        elif ch.isascii() and ch.isalpha():
            out.append("A" if ch.isupper() else "a")
        elif ch.isdigit():
            out.append("0")
        elif "\ue000" <= ch <= "\uf8ff":
            # 자리표시자는 나중에 복원하므로 건드리지 않는다.
            out.append(ch)
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


def is_person_name_key(key):
    """사람 이름을 담는 키인지 판단한다."""
    return bool(key) and key.endswith("Name") and not NON_PERSON_NAME_RE.search(key)


def walk_strings(node):
    """응답 안의 모든 문자열 값을 차례로 돌려준다."""
    if isinstance(node, dict):
        for value in node.values():
            yield from walk_strings(value)
    elif isinstance(node, list):
        for value in node:
            yield from walk_strings(value)
    elif isinstance(node, str):
        yield node


def markers_in(node):
    """응답에 들어 있는 표지를 대문자로 모은다."""
    found = set()
    for text in walk_strings(node):
        found.update(m.upper() for m in MARKER_RE.findall(text))
    return sorted(found)


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


class Masker:
    """응답에서 사람을 알아볼 수 있는 값을 가린다. 같은 사람은 모든 응답에서 같은 별칭을 받는다."""

    def __init__(self):
        # 원래 이메일 → 별칭.
        self.emails = {}
        # 원래 이름 → 별칭.
        self.names = {}

    def email_alias(self, email):
        return self.emails.setdefault(email.lower(), "user%d@masked" % (len(self.emails) + 1))

    def name_alias(self, name):
        return self.names.setdefault(name, "이름%d" % (len(self.names) + 1))

    def learn(self, node):
        """이름 필드를 미리 모아서, 본문 속 이름도 같은 별칭으로 바꿀 수 있게 한다."""
        if isinstance(node, dict):
            for key, value in node.items():
                if isinstance(value, str) and is_person_name_key(key) and value.strip() and not EMAIL_RE.fullmatch(value):
                    self.name_alias(value.strip())
                self.learn(value)
        elif isinstance(node, list):
            for value in node:
                self.learn(value)

    def mask(self, node, key=None):
        """응답 전체를 재귀로 돌며 키에 맞는 규칙으로 값을 가린다."""
        if isinstance(node, dict):
            return {k: self.mask(v, k) for k, v in node.items()}
        if isinstance(node, list):
            return [self.mask(v, key) for v in node]
        if not isinstance(node, str) or node == "":
            return node

        # 본문이 JSON 문자열이면 풀어서 구조를 남긴다.
        stripped = node.strip()
        if stripped[:1] in ("{", "["):
            try:
                parsed = json.loads(stripped)
            except ValueError:
                parsed = None
            if isinstance(parsed, (dict, list)):
                return {"$jsonString": self.mask(parsed, key)}

        if EMAIL_RE.fullmatch(stripped):
            return self.email_alias(stripped)
        if is_person_name_key(key):
            return self.name_alias(stripped)
        if key == "message":
            return self.mask_template(node)
        if URL_RE.fullmatch(stripped):
            return mask_url(stripped)
        if key in TEXT_KEYS or re.search(r"[가-힣ㄱ-ㆎ\s]", node) or len(node) > 40 or (key and key.endswith("Name")):
            return self.mask_text(node)
        # 짧은 식별자(Y/N, 유형 코드, 일시, 숫자 ID)는 그대로 둔다.
        return node

    def _protect_common(self, text, protected):
        """표지·이메일·URL·알려진 이름·HTML 엔티티를 자리표시자로 바꿔 가리기에서 제외한다."""

        def protect(value):
            protected.append(value)
            return PH_OPEN + chr(PH_BASE + len(protected) - 1) + PH_CLOSE

        text = MARKER_RE.sub(lambda m: protect(m.group(0).upper()), text)
        text = URL_RE.sub(lambda m: protect(mask_url(m.group(0))), text)
        text = EMAIL_RE.sub(lambda m: protect(self.email_alias(m.group(0))), text)
        # 긴 이름부터 바꿔야 '김플로'가 '김플로우' 일부를 먼저 먹지 않는다.
        for name in sorted(self.names, key=len, reverse=True):
            alias = self.names[name]
            text = text.replace(name, protect("⟨%s⟩" % alias))
        text = HTML_ENTITY_RE.sub(lambda m: protect(m.group(0)), text)
        return text

    @staticmethod
    def _restore(text, protected):
        pattern = re.compile(re.escape(PH_OPEN) + "(.)" + re.escape(PH_CLOSE))
        return pattern.sub(lambda m: protected[ord(m.group(1)) - PH_BASE], text)

    def mask_text(self, text):
        """글자 내용만 지우고 표기 구조(HTML 태그, @, 괄호, 공백)는 남긴다."""
        protected = []
        text = self._protect_common(text, protected)
        if HTML_TAG_RE.search(text):
            parts = HTML_TAG_RE.split(text)
            text = "".join(self._mask_tag(p) if HTML_TAG_RE.fullmatch(p) else scramble(p) for p in parts)
        else:
            text = scramble(text)
        return self._restore(text, protected)

    def mask_template(self, text):
        """알림 메시지는 시스템 문구라 남기고, 이름과 따옴표·괄호 안 내용만 가린다."""
        protected = []
        text = self._protect_common(text, protected)
        text = QUOTED_RE.sub(lambda m: m.group(1) + scramble(m.group(2)) + m.group(3), text)
        return self._restore(text, protected)

    @staticmethod
    def _mask_tag(tag):
        """태그 이름과 속성 이름은 남기고, 구조 정보가 아닌 속성 값만 가린다."""

        def mask_attr(m):
            lead, name, eq, raw = m.groups()
            quote = raw[0] if raw[:1] in ("'", '"') else ""
            value = raw[1:-1] if quote else raw
            lowered = name.lower()
            keep = (lowered in KEEP_ATTRS and re.fullmatch(r"[A-Za-z0-9_\-:;.# ]{0,80}", value)) or (
                lowered.startswith("data-") and re.fullmatch(r"[A-Za-z_\-]{0,40}", value)
            )
            masked = value if keep else scramble(value)
            return lead + name + eq + quote + masked + quote

        return TAG_ATTR_RE.sub(mask_attr, tag)


class FlowClient:
    """GET 전용 Flow API 클라이언트. 호출 기록을 원본 그대로 메모리에 쌓는다."""

    def __init__(self, base, key):
        self.base = base.rstrip("/")
        self._key = key
        # (라벨, 경로, HTTP 상태, 소요 ms, 원본 응답) 목록.
        self.calls = []

    def get(self, label, path, query=None):
        url = self.base + path
        if query:
            url += "?" + urllib.parse.urlencode(query)
        request = urllib.request.Request(url, headers={"x-flow-api-key": self._key, "Accept": "application/json"})
        started = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                status, raw = response.status, response.read()
        except urllib.error.HTTPError as error:
            status, raw = error.code, error.read()
        elapsed = int((time.monotonic() - started) * 1000)
        try:
            body = json.loads(raw.decode("utf-8")) if raw else None
        except ValueError:
            body = {"$nonJson": raw[:200].decode("utf-8", "replace")}
        shown_path = path + ("?" + urllib.parse.urlencode(query) if query else "")
        self.calls.append((label, shown_path, status, elapsed, body))
        print("  %-22s %s → %d (%dms)" % (label, shown_path, status, elapsed))
        if status in (401, 403, 429):
            raise SystemExit("중단: %s 응답이 %d입니다. 키·권한 정책·호출 한도를 확인해 주세요." % (label, status))
        return status, body

    def alarm_pages(self, label, query, max_pages):
        """알림 목록을 hasNext가 끝날 때까지(상한 max_pages) 따라가며 모은다."""
        alarms, cursor = [], None
        for page in range(1, max_pages + 1):
            page_query = dict(query)
            if cursor is not None:
                page_query["cursor"] = str(cursor)
            _, body = self.get("%s#%d" % (label, page), "/user/alarms", page_query)
            alarms.extend(find_list(body, "alarms") or [])
            if not find_value(body, "hasNext"):
                break
            cursor = find_value(body, "lastCursor")
        return alarms


def alarm_ids(alarms):
    return {str(a.get("alarmId")) for a in alarms}


def is_mention(alarm):
    return alarm.get("mentionYn") == "Y" or alarm.get("alarmType") == "MENTION"


def pick_posts(alarms):
    """상세를 조회할 게시글을 고른다.

    표지가 있는 업무 멘션만 고른다. 표지가 없으면 최신 본문 멘션과 최신 댓글 멘션을 하나씩 고른다.
    """
    with_post = [a for a in alarms if is_mention(a) and str(a.get("postId")) not in EMPTY_IDS]
    marked = [a for a in with_post if markers_in(a)]
    if marked:
        chosen = marked
    else:
        latest_first = sorted(with_post, key=lambda a: str(a.get("registeredDateTime")), reverse=True)
        # remarkId가 비어 있으면 본문 멘션, 있으면 댓글 멘션으로 본다.
        body_mention = [a for a in latest_first if str(a.get("remarkId")) in EMPTY_IDS][:1]
        comment_mention = [a for a in latest_first if str(a.get("remarkId")) not in EMPTY_IDS][:1]
        chosen = body_mention + comment_mention
    post_ids = []
    for alarm in chosen:
        post_id = str(alarm.get("postId"))
        if post_id not in post_ids:
            post_ids.append(post_id)
    return post_ids[:MAX_POSTS]


def walk_items(node, key=None):
    """응답 안의 (키, 값) 쌍을 차례로 돌려준다. 리스트 원소는 부모 키를 물려받는다.

    JSON 문자열을 푼 노드({"$jsonString": ...})는 더 들어가지 않고 통째로 돌려준다.
    """
    if isinstance(node, dict) and "$jsonString" not in node:
        for child_key, value in node.items():
            yield from walk_items(value, child_key)
    elif isinstance(node, list):
        for value in node:
            yield from walk_items(value, key)
    else:
        yield key, node


def collect_values(node, key):
    """응답 전체에서 key의 값을 모두 모은다."""
    return sorted({str(v) for k, v in walk_items(node) if k == key and v is not None})


def mention_snippets(masked_node, limit=10):
    """가린 본문에서 '@'나 'mention'이 든 값을 골라 멘션 표기 형식을 빨리 볼 수 있게 한다."""
    snippets = []
    for key, value in walk_items(masked_node):
        if key not in TEXT_KEYS:
            continue
        # JSON 본문은 문자열로 다시 묶어 구조째 보여 준다.
        text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
        match = re.search(r"@|mention", text, re.IGNORECASE)
        if not match:
            continue
        start = max(0, match.start() - 80)
        snippet = text[start:match.end() + 220]
        if snippet not in snippets:
            snippets.append(snippet)
        if len(snippets) >= limit:
            break
    return snippets


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

    print("Flow API 호출(GET만):")
    unread_query = {"readYn": "N", "size": "100"}
    # 1차: 멘션 필터 미읽음 / 필터 없는 미읽음 / readYn 생략.
    mention_1 = client.alarm_pages("mention_unread", {"filters": "MENTION", "readYn": "N", "size": "100"}, MAX_ALARM_PAGES)
    unread_1 = client.alarm_pages("all_unread_1", unread_query, MAX_ALARM_PAGES)
    mention_any = client.alarm_pages("mention_any", {"filters": "MENTION", "size": "20"}, 1)
    # 2차: 알림 조회만으로 읽음 상태가 바뀌는지 본다. 멘션 여부와 상관없는 동작이라 미읽음 전체를 비교한다.
    unread_2 = client.alarm_pages("all_unread_2", unread_query, MAX_ALARM_PAGES)

    post_ids = pick_posts(mention_1 + unread_1 + mention_any)
    # 게시글 조회가 알림을 읽음 처리하는지도 보려고, 고른 게시글에 안 읽은 알림이 없으면 그런 게시글을 하나 더한다.
    unread_post_ids = [str(a.get("postId")) for a in unread_2 if str(a.get("postId")) not in EMPTY_IDS]
    if unread_post_ids and not set(unread_post_ids) & set(post_ids):
        post_ids = post_ids[:MAX_POSTS - 1] + unread_post_ids[:1]
    post_bodies = {}
    for post_id in post_ids:
        _, post = client.get("post_%s" % post_id, "/user/posts/%s" % post_id)
        _, comments = client.get("comments_%s" % post_id, "/user/comments/%s" % post_id, {"replyYn": "Y", "size": "100"})
        post_bodies[post_id] = (post, comments)
    # 3차: 게시글·댓글 조회가 알림 읽음 상태를 바꾸는지 본다.
    unread_3 = client.alarm_pages("all_unread_3", unread_query, MAX_ALARM_PAGES)

    masker = Masker()
    for call in client.calls:
        masker.learn(call[4])

    # 알림 요약: 표지가 있거나 멘션인 알림만 행으로 남기고, 나머지는 유형별 개수로만 남긴다.
    alarm_rows = {}
    type_counts = {}
    for label, alarms in (("mention_unread", mention_1), ("all_unread_1", unread_1), ("mention_any", mention_any)):
        for alarm in alarms:
            if label == "all_unread_1":
                # 실제 응답의 alarmType은 비어 있을 수 있어서 Yn 플래그 조합으로 센다.
                type_key = "alarmType=%s/mentionYn=%s/registrantYn=%s/workerYn=%s" % (
                    alarm.get("alarmType"), alarm.get("mentionYn"), alarm.get("registrantYn"), alarm.get("workerYn"))
                type_counts[type_key] = type_counts.get(type_key, 0) + 1
            if not (is_mention(alarm) or markers_in(alarm)):
                continue
            alarm_id = str(alarm.get("alarmId"))
            row = alarm_rows.get(alarm_id)
            if row is None:
                row = {field: alarm.get(field) for field in ALARM_FIELDS}
                row["markers"] = markers_in(alarm)
                row["message"] = masker.mask(alarm.get("message"), "message")
                row["content"] = masker.mask(alarm.get("content"), "content")
                row["extraKeys"] = sorted(set(alarm) - set(ALARM_FIELDS) - {"message", "content", "receiverId", "registerId", "registerName"})
                row["seenIn"] = []
                alarm_rows[alarm_id] = row
            row["seenIn"].append(label)

    ids_1, ids_2, ids_3 = alarm_ids(unread_1), alarm_ids(unread_2), alarm_ids(unread_3)
    unread_check = {
        "unreadCounts": [len(ids_1), len(ids_2), len(ids_3)],
        "goneAfterAlarmGets": sorted(ids_1 - ids_2),
        "goneAfterPostAndCommentGets": sorted(ids_2 - ids_3),
        "arrivedDuringRun": sorted((ids_2 | ids_3) - ids_1),
        "fetchedPostsWithUnreadAlarm": [pid for pid in post_ids if pid in unread_post_ids],
    }

    post_rows = []
    for post_id, (post, comments) in post_bodies.items():
        masked_post, masked_comments = masker.mask(post), masker.mask(comments)
        comment_list = find_list(comments, "comments") or []
        post_rows.append({
            "postId": post_id,
            "contentJsonYn": find_value(post, "contentJsonYn"),
            "markersInPost": markers_in(post),
            "commentCount": len(comment_list),
            "repliesReturned": sum(len(c.get("replies") or []) for c in comment_list if isinstance(c, dict)),
            "markersInComments": markers_in(comments),
            "encryptedValues": collect_values(comments, "encrypted"),
            "mentionSnippetsInPost": mention_snippets(masked_post),
            "mentionSnippetsInComments": mention_snippets(masked_comments),
        })

    marker_report = {}
    for marker, place in EXPECTED_MARKERS.items():
        marker_report[marker] = {
            "place": place,
            "alarmIds": sorted(aid for aid, row in alarm_rows.items() if marker in row["markers"]),
            "inPosts": [p["postId"] for p in post_rows if marker in p["markersInPost"] or marker in p["markersInComments"]],
        }

    result = {
        "probe": "flow-alarm-probe",
        "ranAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "note": "이름·이메일·본문 글자는 가렸다(한글→가, 영문→a/A, 숫자→0). ID·유형 코드·일시는 원본이다.",
        "summary": {
            "markers": marker_report,
            "mentionAlarms": list(alarm_rows.values()),
            "allUnreadTypeCounts": type_counts,
            "unreadCheck": unread_check,
            "posts": post_rows,
        },
        "calls": [
            {"label": label, "path": path, "status": status, "ms": ms, "body": masker.mask(body)}
            for label, path, status, ms, body in client.calls
        ],
    }
    with open(out_path, "w", encoding="utf-8") as fp:
        json.dump(result, fp, ensure_ascii=False, indent=2)

    def describe(row):
        return "alarmType=%s postId=%s remarkId=%s replyId=%s readYn=%s" % (
            row["alarmType"], row["postId"], row["remarkId"], row["replyId"], row["readYn"])

    if any(report["alarmIds"] for report in marker_report.values()):
        print("\n표지별 결과:")
        for marker, report in marker_report.items():
            rows = [alarm_rows[aid] for aid in report["alarmIds"]]
            status = "알림 있음 (%s)" % ", ".join(describe(r) for r in rows) if rows else "알림 없음"
            print("  %-14s %s: %s" % (marker, report["place"], status))
    else:
        print("\n표지 없음. 받아 둔 멘션 알림으로 점검했습니다. 최근 멘션 알림(최대 5건):")
        recent = sorted(alarm_rows.values(), key=lambda r: str(r["registeredDateTime"]), reverse=True)[:5]
        for row in recent:
            print("  %s %s" % (row["registeredDateTime"], describe(row)))
        if not recent:
            print("  (멘션 알림이 없습니다)")
    print("\n상세 조회한 게시글: %s" % (", ".join(
        "%s(본문 %s, 댓글 %d개)" % (p["postId"], "JSON" if p["contentJsonYn"] == "Y" else "일반", p["commentCount"]) for p in post_rows
    ) or "없음"))
    print("\n읽음 상태: 미읽음 알림 수 %s, 알림 조회 뒤 사라짐 %d건, 게시글·댓글 조회 뒤 사라짐 %d건" % (
        " → ".join(str(n) for n in unread_check["unreadCounts"]),
        len(unread_check["goneAfterAlarmGets"]),
        len(unread_check["goneAfterPostAndCommentGets"]),
    ))
    print("  안 읽은 알림이 달린 게시글 조회: %s" % (", ".join(unread_check["fetchedPostsWithUnreadAlarm"]) or "없음"))
    if not unread_check["unreadCounts"][0]:
        print("  안 읽은 알림이 없어서 읽음 상태 변화는 판단할 수 없습니다. 새 알림을 받은 뒤 Flow 앱에서 열지 말고 다시 실행해 주세요.")
    print("\n결과 파일: %s" % out_path)
    print("가려지지 않은 이름이나 본문이 없는지 훑어본 뒤 에이전트에게 알려 주세요.")


if __name__ == "__main__":
    main()
