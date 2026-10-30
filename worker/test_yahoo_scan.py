from email import policy
from email.parser import BytesParser
from datetime import datetime, timezone
import json
from . import yahoo_scan as scan

DEMO_ICS = '''BEGIN:VCALENDAR
VERSION:2.0
METHOD:REQUEST
BEGIN:VEVENT
UID:jobpilot-interview-123@example.com
DTSTART;TZID=America/Chicago:20261105T110000
DTEND;TZID=America/Chicago:20261105T113000
SUMMARY:Product Analyst interview
LOCATION:Microsoft Teams
END:VEVENT
END:VCALENDAR'''


def test_calendar_invite_parsing():
    event = scan.parse_ics(DEMO_ICS)
    assert event['when'] == '2026-11-05T11:00:00-06:00'
    assert event['end'] == '2026-11-05T11:30:00-06:00'
    assert event['calendarUid'] == 'jobpilot-interview-123@example.com'
    assert event['dateConfidence'] == 'high'


def test_calendar_cancelled():
    event = scan.parse_ics(DEMO_ICS.replace('METHOD:REQUEST', 'METHOD:CANCEL'))
    assert event['cancelled']


def test_text_date():
    result = scan.parse_text_date('Interview scheduled Thursday, November 5, 2026 at 11:00 AM CT. Please join.', datetime(2026, 11, 1, tzinfo=timezone.utc))
    assert result is not None
    assert datetime.fromisoformat(result).astimezone(timezone.utc).hour == 17


def test_rejection_requires_approval():
    category, stage = scan.classify('Update on application', 'Unfortunately, we will not be moving forward')
    assert (category, stage) == ('rejection', 'Rejected')


def test_message_normalization():
    raw = b'From: Example Recruiting <jobs@example.com>\r\nTo: user@yahoo.com\r\nSubject: Confirmed interview for Product Analyst\r\nMessage-ID: <test-jobpilot@example.com>\r\nDate: Fri, 30 Oct 2026 12:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="abc"\r\n\r\n--abc\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nYour interview is confirmed. Join via https://meet.google.com/abc-defg-hij\r\n--abc\r\nContent-Type: text/calendar; charset=utf-8\r\n\r\n' + DEMO_ICS.encode() + b'\r\n--abc--\r\n'
    parsed = scan.normalize_message(BytesParser(policy=policy.default).parsebytes(raw), 'uid1')
    assert parsed['category'] == 'interview'
    assert parsed['dateConfidence'] == 'high'
    assert parsed['when'] == '2026-11-05T11:00:00-06:00'
    assert parsed['meetingLink'] == 'https://meet.google.com/abc-defg-hij'


def test_encrypted_output_not_plaintext():
    key = '01' * 32
    data = {'version': 1, 'messages': [{'subject': 'Super secret interview'}]}
    output = scan.seal(data, key)
    assert output['cipher'] == 'AES-256-GCM'
    assert 'Super secret interview' not in json.dumps(output)
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from base64 import b64decode
    result = AESGCM(bytes.fromhex(key)).decrypt(b64decode(output['nonce']), b64decode(output['data']), scan.KEY_AAD)
    assert json.loads(result) == data


def test_push_only_schedules_verified_ics_and_excludes_private_data(monkeypatch):
    from datetime import timedelta
    future = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
    captured = {}

    class FakeResponse:
        status = 200
        def __enter__(self): return self
        def __exit__(self, *_): return False

    def fake_open(request, timeout=0):
        captured['body'] = request.data.decode()
        captured['auth'] = request.get_header('Authorization')
        return FakeResponse()

    monkeypatch.setenv('JOBPILOT_PUSH_URL', 'https://jobpilot.workers.dev')
    monkeypatch.setenv('JOBPILOT_PUSH_TOKEN', 'super-secret-' + 'z' * 32)
    monkeypatch.setattr(scan.urllib.request, 'urlopen', fake_open)
    scan.sync_cloud_reminders([
        {'calendarUid': 'calendar123@example.com', 'category':'interview', 'dateConfidence':'high',
         'when':future, 'id':'abc','receivedAt':datetime.now(timezone.utc).isoformat(),
         'subject':'SECRET interview at Secret Corp', 'company':'Secret Corp'},
        {'calendarUid': 'calendarother@example.com', 'category':'interview', 'dateConfidence':'medium',
         'when':future, 'id':'def', 'subject':'Unverified secret date'},
    ])
    payload=json.loads(captured['body'])
    assert payload['source']=='yahoo'
    assert len(payload['reminders'])==3
    assert 'Secret Corp' not in captured['body']
    assert 'calendar123@example.com' not in captured['body']
    assert captured['auth'].startswith('Bearer ')


def test_push_cancellation_latest_message_wins(monkeypatch):
    from datetime import timedelta
    future = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
    payloads = []

    class FakeResponse:
        status = 200
        def __enter__(self): return self
        def __exit__(self, *_): return False

    def fake_open(request, timeout=0):
        payloads.append(json.loads(request.data))
        return FakeResponse()

    monkeypatch.setenv('JOBPILOT_PUSH_URL', 'https://jobpilot.workers.dev')
    monkeypatch.setenv('JOBPILOT_PUSH_TOKEN', 'super-secret-' + 'z' * 32)
    monkeypatch.setattr(scan.urllib.request, 'urlopen', fake_open)
    original = {'calendarUid': 'cancelled-calendar', 'category':'interview',
                'dateConfidence':'high', 'when':future, 'cancelled':False,
                'receivedAt':'2026-10-01T00:00:00+00:00'}
    cancelled = {**original, 'cancelled':True, 'receivedAt':'2026-10-02T00:00:00+00:00'}
    scan.sync_cloud_reminders([original, cancelled])
    assert payloads[0]['reminders']==[]