"""JobPilot groups mail messages into unique appointments, not by sender count."""
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

def setup(page):
    html = (ROOT / 'index.html').read_text()
    html = re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>', '', html)
    html = html.replace('<link rel="stylesheet" href="./style.css">', '<style>' + (ROOT / 'style.css').read_text() + '</style>')
    html = html.replace('<script defer src="./app.js"></script>', '').replace('<script defer src="./push-client.js"></script>', '')
    page.evaluate("""() => { const store=()=>{const d={};return {getItem:k=>d[k]??null,setItem:(k,v)=>d[k]=String(v),removeItem:k=>delete d[k]}};Object.defineProperty(window,'localStorage',{value:store()});Object.defineProperty(window,'sessionStorage',{value:store()});window.confirm=()=>true;}""")
    page.set_content(html)
    code = (ROOT / 'app.js').read_text().replace("if (['localhost', '127.0.0.1'].includes(location.hostname))", "if (true)")
    page.add_script_tag(content=code)

def mail(uid, company, role, when=None, *, confidence='medium', date_only='', calendar_uid='', link=''):
    return dict(id=uid, category='interview', subject=f'{company} interview', company=company, role=role, when=when, dateOnly=date_only,
                receivedAt='2026-11-04T18:00:00Z', dateConfidence=confidence, calendarUid=calendar_uid, meetingLink=link,
                stageSuggestion='Interview')

def test_same_interview_two_emails_one_appointment_but_real_same_day_multiple_visible():
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        c = b.new_context(viewport={'width':390,'height':844}, timezone_id='America/Chicago')
        page=c.new_page(); errors=[];page.on('pageerror', lambda e: errors.append(str(e)))
        setup(page)
        t1='2026-11-06T10:00:00-06:00'
        t2='2026-11-06T14:00:00-06:00'
        t3='2026-11-06T15:00:00-06:00'
        feed={'version':1,'generatedAt':'2026-11-04T18:00:00Z','messages':[
            mail('ics-1','Acme Corporation','Data Analyst',t1,confidence='high',calendar_uid='acme-1'),
            mail('mail-2','Acme Corporation','Data Analyst',t1), # Duplicate of calendar invitation
            mail('dateonly','Acme Corporation','Data Analyst',date_only='2026-11-06',confidence='date-only'),
            mail('other-time','Acme Corporation','Data Analyst',t2), # A second round same day
            mail('other-company','Other Company','BI Analyst',t1), # Separate interview
            mail('other-role','Acme Corporation','HR Analyst',t1), # Separate role, same time
            mail('other-link','Acme Corporation','Data Analyst',t1,link='https://meet.google.com/another-room'),
            mail('third-time','Acme Corporation','Data Analyst',t3),
            mail('pending-a','First Company','Operations Analyst','2026-11-06T16:00:00-06:00'),
            mail('pending-b','First Company','Operations Analyst','2026-11-06T16:00:00-06:00'),
        ]}
        page.evaluate('(feed)=>window.__jobpilotTest.mergeFeed(feed)',feed)
        assert page.locator('#metricInterviews').inner_text()=='1',page.locator('#metricInterviews').inner_text()
        db=page.evaluate('window.__jobpilotTest.getDb()')
        assert len(db['events'])==1
        assert next(m['status'] for m in db['mailbox'] if m['id']=='mail-2') == 'related'
        page.locator('[data-view="calendar"]').last.click()
        page.locator('[data-select-day="2026-11-06"]').click()
        assert '1 scheduled interview · 5 emails to review' in page.locator('#selectedDateCount').inner_text()
        assert page.locator('#selectedDayEvents .detail-event').count()==6
        # Approving a second mail for existing appointment must not add a second event.
        page.locator('[data-view="inbox"]').last.click()
        page.evaluate('''() => { let m=window.__jobpilotTest.getDb().mailbox.find(x=>x.id==='mail-2');m.status='pending';window.__jobpilotTest.applyMail(m); }''')
        assert len(page.evaluate('window.__jobpilotTest.getDb().events'))==1
        # Another distinct appointment at a different time must remain separate when approved.
        page.locator('#mail-other-time [data-approve-mail]').click()
        db=page.evaluate('window.__jobpilotTest.getDb()')
        assert len([e for e in db['events'] if not e.get('cancelled')])==2
        assert not errors,errors
        b.close()

def test_legacy_imported_duplicate_events_are_hidden_without_deleting_manual_events():
    with sync_playwright() as p:
        b=p.chromium.launch(headless=True, executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        c=b.new_context(viewport={'width':390,'height':844},timezone_id='America/Chicago')
        page=c.new_page();setup(page)
        when='2026-11-06T10:00:00-06:00'
        db=page.evaluate('window.__jobpilotTest.getDb()')
        db['mailbox']=[mail('m1','Acme','Data Analyst',when),mail('m2','Acme','Data Analyst',when)]
        for item in db['mailbox']: item['status']='approved'
        db['events']=[
            dict(id='e1',type='Interview',when=when,company='Acme',sourceId='m1',title='Interview',cancelled=False),
            dict(id='e2',type='Interview',when=when,company='Acme',sourceId='m2',title='Interview',cancelled=False),
            dict(id='manual',type='Interview',when=when,company='Acme',title='Interview',userEdited=True,cancelled=False),
        ]
        page.evaluate('(data)=>{ let d=window.__jobpilotTest.getDb();d.mailbox=data.mailbox;d.events=data.events;}',db)
        page.evaluate('(feed)=>window.__jobpilotTest.mergeFeed(feed)', {'version':1,'generatedAt':'2026-11-04T18:00:00Z','messages':[]})
        after=page.evaluate('window.__jobpilotTest.getDb().events')
        assert len(after)==3
        assert len([e for e in after if not e.get('cancelled')])==2 # manual never silently changed
        assert any(e.get('duplicateOf')=='e1' for e in after)
        b.close()

def test_ics_reschedule_updates_the_one_appointment():
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        page=browser.new_page(timezone_id='America/Chicago',viewport={'width':390,'height':844});setup(page)
        first=mail('initial','Acme Corp','Data Analyst','2026-11-06T10:00:00-06:00',confidence='high',calendar_uid='event-one')
        revised=mail('revision','Acme Corporation','Data Analyst','2026-11-06T11:00:00-06:00',confidence='high',calendar_uid='event-one')
        page.evaluate('(m)=>window.__jobpilotTest.mergeFeed({version:1,messages:[m],generatedAt:"2026-11-04T18:00:00Z"})',first)
        page.evaluate('(m)=>window.__jobpilotTest.mergeFeed({version:1,messages:[m],generatedAt:"2026-11-04T18:30:00Z"})',revised)
        db=page.evaluate('window.__jobpilotTest.getDb()')
        assert len(db['events'])==1
        assert db['events'][0]['when']=='2026-11-06T17:00:00.000Z'
        browser.close()

def test_user_can_restore_a_grouped_old_interview():
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        page=browser.new_page(timezone_id='America/Chicago',viewport={'width':390,'height':844});setup(page)
        when='2026-11-06T10:00:00-06:00'
        data=dict(mailbox=[{**mail('m1','Acme','Data Analyst',when), 'status':'auto'}, {**mail('m2','Acme','Data Analyst',when), 'status':'auto'}], events=[
            dict(id='primary',type='Interview',when=when,company='Acme',sourceId='m1',title='Interview',cancelled=False),
            dict(id='duplicate',type='Interview',when=when,company='Acme',sourceId='m2',title='Interview',cancelled=False)
        ])
        page.evaluate('(d)=>{const db=window.__jobpilotTest.getDb();db.mailbox=d.mailbox;db.events=d.events;}',data)
        page.evaluate('()=>window.__jobpilotTest.mergeFeed({version:1,messages:[],generatedAt:"2026-11-04T18:00:00Z"})')
        page.locator('[data-view="calendar"]').last.click(timeout=3000)
        page.locator('[data-select-day="2026-11-06"]').click(timeout=3000)
        assert page.locator('#selectedDayEvents .detail-event').count()==1
        assert page.locator('[data-restore-duplicate]').count()==1
        page.locator('[data-restore-duplicate]').evaluate('(el)=>el.click()',timeout=3000)
        assert page.locator('#selectedDayEvents .detail-event').count()==2
        db=page.evaluate('window.__jobpilotTest.getDb()')
        assert len([e for e in db['events'] if not e.get('cancelled')])==2
        assert db['events'][1]['userEdited'] is True
        browser.close()

def test_two_calendar_emails_same_slot_different_ics_ids_are_one_but_later_slot_is_separate():
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        page=browser.new_page(timezone_id='America/Chicago',viewport={'width':390,'height':844});setup(page)
        feed={'version':1,'generatedAt':'2026-11-04T18:00:00Z','messages':[
            mail('first-ics','Acme Inc','Data Analyst','2026-11-06T10:00:00-06:00',confidence='high',calendar_uid='calendar-id-1'),
            mail('duplicate-ics','Acme','Data Analyst','2026-11-06T10:00:00-06:00',confidence='high',calendar_uid='calendar-id-2'),
            mail('actual-second','Acme','Data Analyst','2026-11-06T13:00:00-06:00',confidence='high',calendar_uid='calendar-id-3')
        ]}
        page.evaluate('(f)=>window.__jobpilotTest.mergeFeed(f)',feed)
        db=page.evaluate('window.__jobpilotTest.getDb()')
        assert len(db['events'])==2
        assert len([m for m in db['mailbox'] if m['status']=='related'])==1
        assert page.locator('#metricInterviews').inner_text()=='2'
        browser.close()