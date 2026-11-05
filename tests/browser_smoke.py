"""In-memory browser UI smoke test for environments that block external Chromium navigation."""
from playwright.sync_api import sync_playwright
from pathlib import Path
ROOT = Path(__file__).resolve().parent
HTML=(ROOT/'index.html').read_text()
import re
HTML=re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>', '', HTML)
HTML=HTML.replace('<script defer src="./app.js"></script>','').replace('<script defer src="./push-client.js"></script>','')
HTML=HTML.replace('<link rel="stylesheet" href="./style.css">', '<style>'+(ROOT/'style.css').read_text()+'</style>')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/lib/chromium/chromium',args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':393,'height':852},accept_downloads=True)
    page=context.new_page()
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.evaluate('''() => {
      const makeStore=()=>{const d={};return{getItem:k=>(k in d?d[k]:null),setItem:(k,v)=>d[k]=String(v),removeItem:k=>delete d[k]}};
      Object.defineProperty(window,'localStorage',{value:makeStore(),configurable:true});
      Object.defineProperty(window,'sessionStorage',{value:makeStore(),configurable:true});
      window.crypto.randomUUID=()=> 'test-'+Math.random().toString(36).slice(2);
      window.confirm=()=>true;
    }''')
    page.set_content(HTML)
    page.add_script_tag(content=(ROOT/'app.js').read_text())
    page.add_script_tag(content=(ROOT/'push-client.js').read_text())
    print('Load:',page.title(), 'JS errors',errors)
    page.locator('[data-view="applications"]').last.click()
    page.locator('[data-action="add-job"]').last.click()
    page.locator('#field-company').fill('Test Systems')
    page.locator('#field-role').fill('Senior Workday Analyst')
    page.locator('#field-priority').select_option('High')
    page.locator('#field-jobUrl').fill('https://example.com/job')
    page.locator('#submitEditor').click()
    assert 'Test Systems' in page.locator('#jobList').inner_text()
    page.locator('#stageFilter').select_option('High priority')
    assert page.locator('.job-card').count()==1
    page.locator('[data-stage-job]').select_option('Screening')
    assert page.locator('.history').count()==1
    page.locator('[data-followup-job]').click()
    assert page.locator('#field-type').input_value()=='Follow-up'
    assert page.locator('#field-when').input_value()
    page.locator('#submitEditor').click()
    page.locator('[data-view="calendar"]').last.click()
    when=page.evaluate('window.__jobpilotTest.getDb().events[0].when') if page.evaluate('!!window.__jobpilotTest') else page.evaluate('JSON.parse(localStorage.getItem("jobpilot.personal.v2")).events[0].when')
    day=page.evaluate('(w)=>{const d=new Date(w);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}',when)
    for _ in range(3):
      if page.locator(f'[data-select-day="{day}"]').count():break
      page.locator('#calendarNext').click()
    page.locator(f'[data-select-day="{day}"]').first.click()
    print('Calendar:',page.locator('#selectedDayEvents').inner_text()[:200])
    page.locator('[data-edit-event]').first.click()
    date=page.locator('#field-when').input_value()
    print('Edit date:',date)
    assert date and not date.endswith('Z')
    assert page.locator('#field-duration').input_value()=='15'
    page.locator('#cancelEditor').click()
    page.locator('.settings-shortcut').click()
    with page.expect_download() as d:page.locator('#exportJobsCsv').click()
    print('CSV:',d.value.suggested_filename)
    with page.expect_download() as d:page.locator('#exportCalendar').click()
    print('ICS:',d.value.suggested_filename)
    page.locator('[data-view="overview"]').last.click()
    page.screenshot(path=str(ROOT/'browser-smoke-preview.png'),full_page=True)
    print('Errors:',errors)
    assert not errors,errors
    browser.close()
