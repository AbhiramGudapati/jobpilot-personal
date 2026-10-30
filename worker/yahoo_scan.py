"""JobPilot Yahoo IMAP -> AES-256-GCM encrypted GitHub Pages feed.

Runs only on the server (GitHub Actions). Never copy account credentials
or decrypted output into the public Pages repository or workflow logs.
"""
from __future__ import annotations

import base64
import hashlib
import html
from html.parser import HTMLParser
import imaplib
import json
import os
import re
import sys
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone
from email import policy
from email.parser import BytesParser
from email.utils import parseaddr, parsedate_to_datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from dateutil import parser as date_parser
from dateutil import tz as date_tz

DEFAULT_TZ = os.environ.get('JOBPILOT_TIMEZONE', 'America/Chicago')
MAX_MESSAGES = min(int(os.environ.get('JOBPILOT_MAX_MESSAGES', '300')), 600)
DAYS_BACK = min(int(os.environ.get('JOBPILOT_DAYS_BACK', '75')), 180)
KEY_AAD = b'jobpilot-feed-v1'
MATCH = re.compile(r'\b(interview|application|applied|candidate|recruit(?:er|ing|ment)|hiring|assessment|screening|offer letter|next steps?|scheduled|reschedul|position|job opening|virtual meeting|not moving forward|unfortunately)\b', re.I)
MEETING = re.compile(r'https?://(?:[\w.-]*\.)?(?:meet\.google\.com|teams\.microsoft\.com|zoom\.us|webex\.com|whereby\.com|calendly\.com|hirevue\.com)[^\s<>"\']*', re.I)
DATE_FRAGMENT = re.compile(r'\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)[,\s]+(?:[A-Z][a-z]+\s+\d{1,2}|\d{1,2}\s+[A-Z][a-z]+)(?:,?\s+\d{4})?[^\n]{0,75}?\b\d{1,2}(?::\d{2})?\s*(?:AM|PM)\b|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s+\d{4})?[^\n]{0,65}?\b\d{1,2}(?::\d{2})?\s*(?:AM|PM)\b', re.I)
TZ_MAP = {'CST': date_tz.gettz('America/Chicago'), 'CDT': date_tz.gettz('America/Chicago'), 'CT': date_tz.gettz('America/Chicago'), 'EST': date_tz.gettz('America/New_York'), 'EDT': date_tz.gettz('America/New_York'), 'ET': date_tz.gettz('America/New_York'), 'PST': date_tz.gettz('America/Los_Angeles'), 'PDT': date_tz.gettz('America/Los_Angeles'), 'PT': date_tz.gettz('America/Los_Angeles'), 'UTC': timezone.utc, 'GMT': timezone.utc}


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.hidden += 1
        elif tag in ('p', 'div', 'br', 'li', 'tr'):
            self.parts.append(' ')

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def cleaned(text: str) -> str:
    return re.sub(r'\s+', ' ', html.unescape(text or '')).strip()


def html_text(source: str) -> str:
    parser = PlainText()
    parser.feed(source or '')
    return cleaned(''.join(parser.parts))


def message_parts(msg) -> tuple[str, str]:
    plain, markup, calendars = [], [], []
    for part in msg.walk():
        if part.is_multipart():
            continue
        kind = part.get_content_type()
        try:
            value = part.get_content()
            if isinstance(value, bytes):
                value = value.decode(part.get_content_charset() or 'utf-8', errors='replace')
        except Exception:
            value = (part.get_payload(decode=True) or b'').decode('utf-8', errors='replace')
        if kind == 'text/calendar' or (part.get_filename() or '').lower().endswith('.ics'):
            calendars.append(value)
        elif part.get_content_disposition() != 'attachment' and kind == 'text/plain':
            plain.append(value)
        elif part.get_content_disposition() != 'attachment' and kind == 'text/html':
            markup.append(value)
    body = cleaned(' '.join(plain)) or html_text(' '.join(markup))
    return body[:18000], '\n'.join(calendars)[:50000]


def parse_ics_datetime(value: str, params: str = '') -> datetime | None:
    if not value:
        return None
    match = re.search(r'TZID=([^;:]+)', params, re.I)
    tzname = match.group(1).strip('"') if match else DEFAULT_TZ
    zone = date_tz.gettz(tzname) or ZoneInfo(DEFAULT_TZ)
    try:
        if re.fullmatch(r'\d{8}T\d{6}Z', value):
            return datetime.strptime(value, '%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
        if re.fullmatch(r'\d{8}T\d{6}', value):
            return datetime.strptime(value, '%Y%m%dT%H%M%S').replace(tzinfo=zone)
        if re.fullmatch(r'\d{8}T\d{4}', value):
            return datetime.strptime(value, '%Y%m%dT%H%M').replace(tzinfo=zone)
        if re.fullmatch(r'\d{8}', value):
            return datetime.strptime(value, '%Y%m%d').replace(tzinfo=zone)
    except ValueError:
        pass
    return None


def parse_ics(source: str) -> dict | None:
    if not source:
        return None
    # RFC 5545 folded content lines. Extract first VEVENT only.
    unfolded = re.sub(r'\r?\n[ \t]', '', source).splitlines()
    props = {}
    is_event = False
    for line in unfolded:
        if line.upper().startswith('BEGIN:VEVENT'):
            is_event = True
            continue
        if line.upper().startswith('END:VEVENT') and is_event:
            break
        if is_event and ':' in line:
            lhs, rhs = line.split(':', 1)
            name, _, params = lhs.partition(';')
            props[name.upper()] = (rhs, params)
    if not props:
        return None
    start = parse_ics_datetime(*props.get('DTSTART', ('', '')))
    end = parse_ics_datetime(*props.get('DTEND', ('', '')))
    if start and not end:
        end = start + timedelta(minutes=30)
    unescape = lambda s: s.replace('\\n', ' ').replace('\\,', ',').replace('\\;', ';')
    return {
        'when': start.isoformat() if start else None,
        'end': end.isoformat() if end else None,
        'calendarUid': props.get('UID', ('', ''))[0][:200],
        'title': unescape(props.get('SUMMARY', ('', ''))[0])[:180],
        'location': unescape(props.get('LOCATION', ('', ''))[0])[:250],
        'meetingLink': props.get('URL', ('', ''))[0][:600],
        'cancelled': props.get('STATUS', ('', ''))[0].upper() == 'CANCELLED' or 'METHOD:CANCEL' in source.upper(),
        'dateConfidence': 'high' if start else 'none'
    }


def parse_text_date(body: str, received: datetime) -> str | None:
    for match in DATE_FRAGMENT.finditer(body[:8500]):
        fragment = match.group(0)
        # Capture a trailing timezone abbreviation; preserve the user's local zone otherwise.
        trailing_zone = re.match(r'^\s*(CT|CDT|CST|ET|EDT|EST|PT|PDT|PST|UTC|GMT)\b', body[match.end():match.end() + 12], re.I)
        if trailing_zone:
            fragment += ' ' + trailing_zone.group(1).upper()
        # Keep the default naive: dateutil otherwise inherits received email's UTC tzinfo.
        base = received.astimezone(ZoneInfo(DEFAULT_TZ)).replace(month=1, day=1, hour=12, minute=0, second=0, microsecond=0, tzinfo=None)
        try:
            found = date_parser.parse(fragment, fuzzy=True, default=base, tzinfos=TZ_MAP)
            if found.tzinfo is None:
                found = found.replace(tzinfo=ZoneInfo(DEFAULT_TZ))
            return found.isoformat()
        except (ValueError, OverflowError):
            continue
    return None


def classify(subject: str, body: str) -> tuple[str, str | None]:
    text = (subject + ' ' + body[:2600]).lower()
    if re.search(r'\b(cancelled|canceled|interview cancellation)\b', text) and 'interview' in text:
        return 'interview_cancelled', None
    if re.search(r'\b(unfortunately|not moving forward|not selected|other candidates|regret to inform|will not be proceeding|position has been filled)\b', text):
        return 'rejection', 'Rejected'
    if re.search(r'\b(offer letter|pleased to offer|job offer|offer of employment)\b', text):
        return 'offer', 'Offer'
    if re.search(r'\b(interview|meet with (?:the )?hiring manager|virtual onsite|scheduling confirmation|scheduled to interview|interview confirmed|screening call)\b', text):
        return 'interview', 'Interview'
    if re.search(r'\b(assessment|coding challenge|take.home exercise|online test)\b', text):
        return 'assessment', 'Screening'
    if re.search(r'\b(follow up|checking in|next steps|availability|schedule a call|select a time|schedule your)\b', text):
        return 'followup', None
    if re.search(r'\b(thanks? for applying|application received|submitted your application|thank you for your interest|application confirmation)\b', text):
        return 'application', 'Applied'
    return 'other', None


def company_from(subject: str, sender: str, address: str, body: str) -> str:
    for string in (subject[:160], body[:400]):
        for pattern in (r'\b(?:interview|position|opportunity|application)\s+(?:with|at|from)\s+([A-Z][\w& .\'-]{2,45})', r'\b(?:company|organization)\s*:\s*([A-Z][\w& .\'-]{2,45})'):
            match = re.search(pattern, string, re.I)
            if match:
                return re.split(r'\s+(?:on|for|has|is|to|and)\s+|[,;|\n]', match.group(1))[0].strip(' .')[:60]
    bad = {'recruiting', 'recruitment', 'talent', 'workday', 'greenhouse', 'lever', 'notifications', 'no-reply', 'noreply', 'jobvite'}
    candidate = re.sub(r'\b(?:recruiting|recruitment|talent acquisition|careers|jobs|team|human resources)\b', '', sender, flags=re.I).strip(' -|')
    if candidate and candidate.lower() not in bad and len(candidate) <= 60 and '@' not in candidate:
        return candidate
    domain = address.rsplit('@', 1)[-1].split('.')[0] if '@' in address else ''
    return domain.title() if domain and domain not in bad and domain not in ('gmail', 'yahoo', 'outlook') else ''


def role_from(subject: str, body: str) -> str:
    text = subject + ' ' + body[:750]
    for pattern in (r'\b(?:role|position|job title)\s*:\s*([^\n|;]{4,90})', r'\b(?:interview|application)\s+for\s+(?:the\s+)?([^|,.\n]{4,85})', r'\bfor the\s+([^|,.\n]{4,85})\s+(?:role|position)'):
        match = re.search(pattern, text, re.I)
        if match:
            result = re.split(r'\s+(?:at|with|on|scheduled|and)\b', match.group(1), maxsplit=1)[0].strip(' .,:')
            if 3 < len(result) < 80:
                return result
    return ''


def normalize_message(msg, uid: str = '') -> dict | None:
    subject = cleaned(str(msg.get('Subject', '')))
    sender, address = parseaddr(str(msg.get('From', '')))
    address = address.lower()[:150]
    body, ics = message_parts(msg)
    if not MATCH.search(subject + ' ' + body[:1300]) and not ics:
        return None
    category, stage = classify(subject, body)
    parsed_ics = parse_ics(ics)
    if category == 'other' and not parsed_ics:
        return None
    try:
        received = parsedate_to_datetime(str(msg.get('Date', '')))
        if received.tzinfo is None:
            received = received.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError, IndexError):
        received = datetime.now(timezone.utc)
    received = received.astimezone(timezone.utc)
    when = parsed_ics.get('when') if parsed_ics else None
    if not when and category in ('interview', 'followup', 'assessment'):
        when = parse_text_date(body, received)
    link = next(iter(MEETING.findall(body + ' ' + (parsed_ics.get('meetingLink', '') if parsed_ics else ''))), '')
    if not link and parsed_ics and re.match(r'^https?://', parsed_ics.get('meetingLink', ''), re.I):
        link = parsed_ics['meetingLink']
    link = link.rstrip('.,)>;')[:600]
    message_id = str(msg.get('Message-ID', '')).strip().lower()
    stable_id = hashlib.sha256((message_id or uid + '|' + subject + '|' + str(received)).encode()).hexdigest()[:24]
    result = {
        'id': stable_id,
        'subject': subject[:210],
        'sender': cleaned(sender)[:90],
        'fromEmail': address,
        'receivedAt': received.isoformat(),
        'category': category,
        'stageSuggestion': stage,
        'company': company_from(subject, sender, address, body),
        'role': role_from(subject, body),
        'preview': body[:230],
        'when': when,
        'end': parsed_ics.get('end') if parsed_ics else None,
        'calendarUid': parsed_ics.get('calendarUid') if parsed_ics else '',
        'title': parsed_ics.get('title') if parsed_ics else '',
        'location': parsed_ics.get('location') if parsed_ics else '',
        'meetingLink': link,
        'cancelled': bool(parsed_ics and parsed_ics.get('cancelled')),
        'dateConfidence': ('high' if when and parsed_ics else 'medium' if when else 'none'),
    }
    return result


def scan_mailbox() -> list[dict]:
    user = os.environ['YAHOO_EMAIL'].strip()
    password = os.environ['YAHOO_APP_PASSWORD'].strip()
    if not user or not password:
        raise RuntimeError('Yahoo credentials missing')
    results = []
    with imaplib.IMAP4_SSL('imap.mail.yahoo.com', 993, timeout=30) as client:
        client.login(user, password)
        typ, _ = client.select('INBOX', readonly=True)
        if typ != 'OK':
            raise RuntimeError('Could not select Yahoo inbox')
        cutoff = (datetime.now(timezone.utc) - timedelta(days=DAYS_BACK)).strftime('%d-%b-%Y')
        typ, payload = client.uid('search', None, 'SINCE', cutoff)
        if typ != 'OK':
            raise RuntimeError('Yahoo inbox search failed')
        ids = (payload[0] or b'').split()[-MAX_MESSAGES:]
        for raw_uid in reversed(ids):
            uid = raw_uid.decode('ascii', errors='replace')
            typ, response = client.uid('fetch', raw_uid, '(BODY.PEEK[])')
            if typ != 'OK':
                continue
            raw = next((part[1] for part in response if isinstance(part, tuple) and isinstance(part[1], bytes)), None)
            if not raw:
                continue
            try:
                parsed = normalize_message(BytesParser(policy=policy.default).parsebytes(raw), uid)
                if parsed:
                    results.append(parsed)
            except Exception:
                # Skip a single malformed mail without leaking its content to logs.
                continue
        client.close()
    return results


def seal(data: dict, key_hex: str) -> dict:
    key = bytes.fromhex(key_hex.strip())
    if len(key) != 32:
        raise ValueError('JOBPILOT_SYNC_KEY must be exactly 64 hexadecimal characters (32 bytes)')
    nonce = os.urandom(12)
    plaintext = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    ciphertext = AESGCM(key).encrypt(nonce, plaintext, KEY_AAD)
    return {'version': 1, 'cipher': 'AES-256-GCM', 'nonce': base64.b64encode(nonce).decode(), 'data': base64.b64encode(ciphertext).decode()}



def sync_cloud_reminders(messages: list[dict]) -> None:
    """Schedule only high-confidence calendar invitations for closed-app push.

    No company, role, email contents, meeting links, or subjects are uploaded.
    Missing credentials means the optional integration stays disabled.
    """
    server = os.environ.get('JOBPILOT_PUSH_URL', '').strip().rstrip('/')
    token = os.environ.get('JOBPILOT_PUSH_TOKEN', '').strip()
    if not server or not token:
        return
    if not re.fullmatch(r'https://[a-zA-Z0-9.-]+', server) or len(token) < 32:
        print('Push sync settings invalid; Yahoo feed will still be published.')
        return
    # Most recent update for a calendar UID wins, including cancellations.
    by_id = {}
    sorted_messages = sorted(messages, key=lambda m: str(m.get('receivedAt', '')), reverse=True)
    current_time = datetime.now(timezone.utc)
    for m in sorted_messages:
        if m.get('category') not in ('interview', 'assessment', 'interview_cancelled'):
            continue
        if m.get('dateConfidence') != 'high' or not m.get('calendarUid'):
            continue
        stable = hashlib.sha256(str(m['calendarUid']).encode()).hexdigest()[:30]
        if stable in by_id:
            continue
        by_id[stable] = m
    reminders = []
    for stable, m in by_id.items():
        if m.get('cancelled'):
            continue
        try:
            event_at = datetime.fromisoformat(str(m.get('when', '')).replace('Z', '+00:00'))
            if event_at.tzinfo is None:
                continue
            event_ms = int(event_at.timestamp() * 1000)
        except (ValueError, TypeError, OverflowError):
            continue
        if event_at <= current_time or event_at > current_time + timedelta(days=366):
            continue
        for milestone in (1440, 60, 15):
            if event_ms - milestone * 60_000 <= int(current_time.timestamp() * 1000) + 10_000:
                continue
            reminders.append({
                'id': 'mail:' + stable,
                'milestone': milestone,
                'fireAt': event_ms - milestone * 60_000,
                'eventAt': event_ms,
                'kind': 'Interview' if m.get('category') == 'interview' else 'Deadline',
            })
    payload = json.dumps({'source': 'yahoo', 'reminders': reminders}).encode('utf-8')
    request = urllib.request.Request(
        server + '/reminders', payload, method='PUT',
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            if response.status != 200:
                print('Push reminders could not sync; Yahoo feed still updates.')
            else:
                print(f'Cloud reminders synchronized from {len(by_id)} high-confidence calendar entries.')
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        print(f'Push schedule sync unavailable ({type(exc).__name__}); Yahoo scan will continue.')


def main():
    # Fail without overwriting the previous healthy feed when Yahoo is unavailable.
    key = os.environ['JOBPILOT_SYNC_KEY']
    messages = scan_mailbox()
    sync_cloud_reminders(messages)
    output = {'version': 1, 'generatedAt': datetime.now(timezone.utc).isoformat(), 'messages': messages}
    destination = Path(os.environ.get('JOBPILOT_OUTPUT', 'feed.json'))
    # Avoid a new git commit every 30 minutes when no messages changed.
    # Still refresh at least twice daily so the UI can show a recent heartbeat.
    if destination.exists():
        try:
            previous = json.loads(destination.read_text(encoding='utf-8'))
            old_plaintext = AESGCM(bytes.fromhex(key.strip())).decrypt(
                base64.b64decode(previous['nonce']), base64.b64decode(previous['data']), KEY_AAD)
            old = json.loads(old_plaintext)
            age = datetime.now(timezone.utc) - datetime.fromisoformat(old['generatedAt'])
            if old['messages'] == messages and age < timedelta(hours=12):
                print('No recruitment mail changes. Previous encrypted feed kept.')
                return
        except (ValueError, KeyError, TypeError):
            pass
    destination.write_text(json.dumps(seal(output, key), separators=(',', ':')) + '\n', encoding='utf-8')
    print(f'Encrypted feed refreshed, {len(messages)} relevant messages. No private message details printed.')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'Scan failed: {type(exc).__name__}. Check Actions secrets, Yahoo app-password eligibility, and connectivity.', file=sys.stderr)
        sys.exit(1)