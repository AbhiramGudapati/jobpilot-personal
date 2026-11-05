"""Regression tests for calendar coverage: confirmed + text-only + date-only invites."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re

ROOT=Path(__file__).resolve().parents[1]

def test_november_6_shows_two_interviews_and_review_flow():
    errors=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        context=browser.new_context(viewport={'width':390,'height':844},timezone_id='America/Chicago')
        page=context.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        html=(ROOT/'index.html').read_text()
        html=re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>', '', html)
        html=html.replace('<link rel="stylesheet" href="./style.css">','<style>'+(ROOT/'style.css').read_text()+'</style>')
        html=html.replace('<script defer src="./app.js"></script>','').replace('<script defer src="./push-client.js"></script>','')
        page.evaluate('''() => { const d={}; Object.defineProperty(window,'localStorage',{value:{getItem:k=>(k in d?d[k]:null),setItem:(k,v)=>d[k]=String(v),removeItem:k=>delete d[k]}}); const ss={}; Object.defineProperty(window,'sessionStorage',{value:{getItem:k=>(k in ss?ss[k]:null),setItem:(k,v)=>ss[k]=String(v),removeItem:k=>delete ss[k]}}); window.confirm=()=>true; }''')
        page.set_content(html)
        app_source=(ROOT/'app.js').read_text().replace("if (['localhost', '127.0.0.1'].includes(location.hostname))",'if (true)')
        page.add_script_tag(content=app_source)
        assert page.evaluate('!!window.__jobpilotTest')
        # Two *different* interviews on Nov 6: calendar ICS high confidence, plain text medium.
        # A third date-only lead proves that no time is invented for incomplete emails.
        data={"version":1,"generatedAt":"2026-11-04T23:00:00Z","messages":[
            {"id":"ics-vcu-6","subject":"ERP Workstream Analyst interview","title":"ERP Workstream Analyst","category":"interview","stageSuggestion":"Interview","company":"VCU Health","role":"ERP Workstream Analyst","when":"2026-11-06T14:00:00-06:00","end":"2026-11-06T14:45:00-06:00","calendarUid":"vcu-nov6","dateConfidence":"high","receivedAt":"2026-11-02T16:00:00Z"},
            {"id":"text-hr-6","subject":"Interview confirmed for Sr Analyst, HR Shared Services","category":"interview","stageSuggestion":"Interview","company":"Example HR Team","role":"Sr Analyst, HR Shared Services","when":"2026-11-06T10:30:00-06:00","dateConfidence":"medium","receivedAt":"2026-11-02T18:00:00Z"},
            {"id":"date-only-7","subject":"Interview on November 7, time to follow","category":"interview","company":"New Company","role":"Compensation Analyst","dateOnly":"2026-11-07","dateConfidence":"date-only","receivedAt":"2026-11-02T18:00:00Z"}
        ]}
        page.evaluate('(feed) => window.__jobpilotTest.mergeFeed(feed)', data)
        page.wait_for_timeout(80)
        assert page.locator('#metricInterviews').inner_text()=='1'
        assert '1 scheduled · 2 emails to review' in page.locator('#metricInterviewHint').inner_text()
        assert page.locator('#nextInterview .interview-list-item').count()==3
        page.locator('[data-view="calendar"]').last.click()
        page.locator('[data-select-day="2026-11-06"]').click()
        assert '1 scheduled interview · 1 email to review' in page.locator('#selectedDateCount').inner_text()
        assert page.locator('#selectedDayEvents .detail-event').count()==2
        assert page.locator('#selectedDayEvents .tentative-event').count()==1
        assert 'VCU Health' in page.locator('#selectedDayEvents').inner_text()
        assert 'Example HR Team' in page.locator('#selectedDayEvents').inner_text()
        page.screenshot(path=str(ROOT/'nov6-two-interviews-mobile.png'),full_page=True)
        # Confirm text-only invite, should not duplicate ICS entry.
        page.locator('#selectedDayEvents [data-find-mail="text-hr-6"]').click()
        assert 'Review emails' in page.locator('#inbox-heading').inner_text()
        assert page.locator('#mail-text-hr-6').count()==1
        page.locator('#mail-text-hr-6 [data-approve-mail]').click()
        assert page.locator('#metricInterviewHint').inner_text().startswith('2 scheduled')
        page.locator('[data-view="calendar"]').last.click()
        page.locator('[data-select-day="2026-11-06"]').click()
        assert page.locator('#selectedDayEvents .detail-event').count()==2
        assert page.locator('#selectedDayEvents .tentative-event').count()==0
        # Same message received on later sync should not reimport.
        page.evaluate('(feed) => window.__jobpilotTest.mergeFeed(feed)',data)
        page.locator('[data-select-day="2026-11-06"]').click()
        assert page.locator('#selectedDayEvents .detail-event').count()==2
        # Date only entry is visible, user must supply actual start time.
        page.locator('[data-select-day="2026-11-07"]').click()
        assert '0 scheduled interviews · 1 email to review' in page.locator('#selectedDateCount').inner_text()
        assert 'Time to confirm' in page.locator('#selectedDayEvents').inner_text()
        page.locator('#selectedDayEvents [data-find-mail="date-only-7"]').click()
        page.locator('#mail-date-only-7 [data-edit-mail-event]').click()
        assert page.locator('#field-when').input_value()==''
        page.locator('#field-when').fill('2026-11-07T09:30')
        page.locator('#submitEditor').click()
        assert page.locator('#metricInterviewHint').inner_text().startswith('3 scheduled')
        # Persisted after reload.
        persisted = page.evaluate('JSON.parse(localStorage.getItem("jobpilot.personal.v2"))')
        assert len([e for e in persisted['events'] if e['type']=='Interview'])==3
        assert len([e for e in persisted['events'] if e['type']=='Interview' and e['when'].startswith('2026-11-06')])==2
        assert not errors,errors
        browser.close()